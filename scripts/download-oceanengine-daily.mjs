#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const DEFAULT_REPORT_ID = "48378753";

function parseArgs(argv) {
  const args = {
    config: "config/backend-download.example.json",
    start: null,
    end: null,
    accountId: null,
    accountName: null,
    dryRun: false
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--config") args.config = argv[++i];
    else if (arg === "--start") args.start = argv[++i];
    else if (arg === "--end") args.end = argv[++i];
    else if (arg === "--date") {
      args.start = argv[++i];
      args.end = args.start;
    } else if (arg === "--account-id") args.accountId = argv[++i];
    else if (arg === "--account-name") args.accountName = argv[++i];
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage:
  node scripts/download-oceanengine-daily.mjs --config config/backend-download.json --date 2026-06-22

Options:
  --config <path>       Config JSON path
  --date <YYYY-MM-DD>   Single report date
  --start <YYYY-MM-DD>  Start date
  --end <YYYY-MM-DD>    End date
  --account-id <id>     Override config and run one account
  --account-name <name> Account name for override mode
  --dry-run             Print planned URLs without opening browser
`);
}

function expandHome(path) {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

function loadConfig(path) {
  const abs = resolve(expandHome(path));
  if (!existsSync(abs)) throw new Error(`Config not found: ${abs}`);
  return JSON.parse(readFileSync(abs, "utf8"));
}

function normalizeRun(config, args) {
  const start = args.start || config.dateRange?.start;
  const end = args.end || config.dateRange?.end || start;
  if (!start || !end) throw new Error("Missing date range. Use --date or config.dateRange.");

  const accounts = args.accountId
    ? [{ id: args.accountId, name: args.accountName || args.accountId, reportId: config.reportId }]
    : config.accounts || [];

  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error("No accounts configured.");
  }

  return {
    chromeProfile: expandHome(config.chromeProfile || "~/.oceanengine-data/chrome-profile"),
    downloadDir: expandHome(config.downloadDir || "~/Downloads"),
    headless: Boolean(config.headless),
    start,
    end,
    reportId: config.reportId || DEFAULT_REPORT_ID,
    accounts
  };
}

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    throw new Error("Missing dependency: playwright. Run `npm install` in this folder first.");
  }
}

function reportUrl(account, defaultReportId) {
  const reportId = account.reportId || defaultReportId || DEFAULT_REPORT_ID;
  return `https://ad.oceanengine.com/statistics_pages/ad_report/customize/report/detail/${reportId}?aadvid=${account.id}`;
}

async function launchBrowser(playwright, run) {
  mkdirSync(run.chromeProfile, { recursive: true });
  mkdirSync(run.downloadDir, { recursive: true });

  return await playwright.chromium.launchPersistentContext(run.chromeProfile, {
    channel: "chrome",
    headless: run.headless,
    acceptDownloads: true,
    downloadsPath: run.downloadDir,
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
    viewport: { width: 1440, height: 980 },
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-dev-shm-usage"
    ]
  });
}

async function downloadAccountReport(context, run, account) {
  const page = await context.newPage();
  const url = reportUrl(account, run.reportId);
  const result = {
    account: account.name,
    accountId: account.id,
    start: run.start,
    end: run.end,
    url,
    status: "started",
    downloadedPath: null,
    note: ""
  };

  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(3000);

  let bodyText = await safeBodyText(page);
  if (needsManualFangzhouEntry(bodyText)) {
    result.status = "needs_fangzhou_entry";
    result.note = "Direct Ocean Engine report URL was blocked. Open Fangzhou, enter this account once, then rerun.";
    await page.close();
    return result;
  }

  if (isLoginOrEmpty(bodyText)) {
    result.status = "needs_login";
    result.note = "Browser is not logged in or report page did not load. Log in with this Chrome profile, then rerun.";
    await page.close();
    return result;
  }

  await ensureBasicDataTopic(page);
  await setDateRange(page, run.start, run.end);
  await clickQuery(page);
  await page.waitForTimeout(5000);

  const rowInfo = await extractRowInfo(page);
  const download = await triggerDownload(page);
  if (!download) {
    result.status = "download_failed";
    result.note = `Could not trigger download. ${rowInfo}`;
    await page.close();
    return result;
  }

  const suggested = download.suggestedFilename();
  const savedPath = join(run.downloadDir, suggested);
  await download.saveAs(savedPath);

  result.status = "downloaded";
  result.downloadedPath = savedPath;
  result.note = rowInfo;
  await page.close();
  return result;
}

function needsManualFangzhouEntry(text) {
  return text.includes("内部员工登录") ||
    text.includes("代理商一站式访问") ||
    text.includes("无法使用 巨量引擎工作台") ||
    text.includes("无法使用巨量引擎工作台");
}

function isLoginOrEmpty(text) {
  const t = text.trim();
  return t.length < 20 || t.includes("登录") && t.includes("验证码");
}

async function safeBodyText(page) {
  try {
    return await page.locator("body").innerText({ timeout: 10000 });
  } catch {
    return "";
  }
}

async function ensureBasicDataTopic(page) {
  const text = await safeBodyText(page);
  if (text.includes("基础数据")) return;
  // Leave as best-effort. Some saved reports already contain the selected topic
  // but do not render the topic dropdown text in body until opened.
}

async function setDateRange(page, start, end) {
  const inputs = page.locator("input");
  const count = await inputs.count();

  for (let i = 0; i < count; i += 1) {
    const input = inputs.nth(i);
    const placeholder = await input.getAttribute("placeholder").catch(() => "");
    if (placeholder?.includes("开始日期")) {
      await input.fill(start);
      await input.press("Enter").catch(() => {});
    }
    if (placeholder?.includes("结束日期")) {
      await input.fill(end);
      await input.press("Enter").catch(() => {});
    }
  }
}

async function clickQuery(page) {
  for (const text of ["查询", "刷新", "确定"]) {
    const button = page.getByText(text, { exact: true }).last();
    if (await button.isVisible({ timeout: 1200 }).catch(() => false)) {
      await button.click({ timeout: 3000 }).catch(() => {});
      return;
    }
  }
}

async function extractRowInfo(page) {
  const text = await safeBodyText(page);
  const rowMatch = text.match(/总计共\s*\d+\s*条记录/);
  const costMatch = text.match(/消耗[^\n]*\n?([0-9,.]+)/);
  return [rowMatch?.[0], costMatch ? `cost=${costMatch[1]}` : ""].filter(Boolean).join("; ");
}

async function triggerDownload(page) {
  const candidates = ["下载", "导出"];
  for (const text of candidates) {
    const loc = page.getByText(text, { exact: true }).last();
    if (!(await loc.isVisible({ timeout: 1500 }).catch(() => false))) continue;
    const downloadPromise = page.waitForEvent("download", { timeout: 60000 }).catch(() => null);
    await loc.click({ timeout: 5000 }).catch(() => {});
    const download = await downloadPromise;
    if (download) return download;
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv);
  const config = loadConfig(args.config);
  const run = normalizeRun(config, args);

  if (args.dryRun) {
    console.log(JSON.stringify({
      start: run.start,
      end: run.end,
      accounts: run.accounts.map((account) => ({
        name: account.name,
        id: account.id,
        url: reportUrl(account, run.reportId)
      }))
    }, null, 2));
    return;
  }

  const { chromium } = await loadPlaywright();
  const context = await launchBrowser({ chromium }, run);
  const results = [];
  try {
    for (const account of run.accounts) {
      results.push(await downloadAccountReport(context, run, account));
    }
  } finally {
    await context.close();
  }

  console.log(JSON.stringify({ start: run.start, end: run.end, results }, null, 2));
  if (results.some((item) => item.status !== "downloaded")) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
