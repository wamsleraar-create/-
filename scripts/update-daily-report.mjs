#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

function parseArgs(argv) {
  const args = {
    config: "config/daily-report.example.json",
    date: yesterdayLocal(),
    dryRun: false,
    noImport: false
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--config") args.config = argv[++i];
    else if (arg === "--date") args.date = argv[++i];
    else if (arg === "--dry-run") args.dryRun = true;
    else if (arg === "--no-import") args.noImport = true;
    else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function yesterdayLocal() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return formatDate(d);
}

function formatDate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function printHelp() {
  console.log(`Usage:
  node scripts/update-daily-report.mjs --config config/daily-report.json --date 2026-06-22

Options:
  --config <path>   Config JSON path. Default: config/daily-report.example.json
  --date <date>     Report date in YYYY-MM-DD. Default: yesterday
  --dry-run         Print planned actions without importing to Feishu
  --no-import       Only find and validate local Excel files
`);
}

function expandHome(path) {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

function loadConfig(configPath) {
  const absPath = resolve(expandHome(configPath));
  if (!existsSync(absPath)) {
    throw new Error(`Config not found: ${absPath}`);
  }
  const raw = readFileSync(absPath, "utf8");
  const config = JSON.parse(raw);
  validateConfig(config, absPath);
  return config;
}

function validateConfig(config, configPath) {
  if (!Array.isArray(config.accounts) || config.accounts.length === 0) {
    throw new Error(`${configPath}: accounts must contain at least one account`);
  }
  for (const account of config.accounts) {
    if (!account.name || !account.id) {
      throw new Error(`${configPath}: every account needs name and id`);
    }
  }
}

function listCandidateFiles(downloadDir, accountId, sinceHours) {
  const dir = resolve(expandHome(downloadDir));
  if (!existsSync(dir)) {
    throw new Error(`Download directory not found: ${dir}`);
  }
  const minMtime = Date.now() - Number(sinceHours || 48) * 60 * 60 * 1000;
  return readdirSync(dir)
    .filter((name) => name.endsWith(".xlsx") && name.includes(accountId))
    .map((name) => {
      const path = join(dir, name);
      const stat = statSync(path);
      return { path, name, mtimeMs: stat.mtimeMs, size: stat.size };
    })
    .filter((file) => file.mtimeMs >= minMtime)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function reportName(template, account, date) {
  return String(template || "巨量日报_{date}_{accountName}")
    .replaceAll("{date}", date)
    .replaceAll("{accountName}", account.name)
    .replaceAll("{accountId}", account.id);
}

function importToFeishu(file, name, feishu, dryRun) {
  const args = ["drive", "+import", "--file", file.path, "--type", feishu.type || "sheet", "--name", name, "--json"];
  if (feishu.folderToken) args.push("--folder-token", feishu.folderToken);
  if (dryRun) args.push("--dry-run");

  const result = spawnSync("lark-cli", args, { encoding: "utf8" });
  return {
    command: `lark-cli ${args.map(shellQuote).join(" ")}`,
    status: result.status,
    stdout: result.stdout.trim(),
    stderr: result.stderr.trim()
  };
}

function shellQuote(value) {
  if (/^[a-zA-Z0-9_./:=+-]+$/.test(value)) return value;
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function main() {
  const args = parseArgs(process.argv);
  const config = loadConfig(args.config);
  const shouldImport = config.feishu?.enabled !== false && !args.noImport;
  const summary = [];

  for (const account of config.accounts) {
    const candidates = listCandidateFiles(config.downloadDir || "~/Downloads", account.id, config.sinceHours);
    const file = candidates[0];
    const name = reportName(config.reportNameTemplate, account, args.date);

    if (!file) {
      summary.push({
        account: account.name,
        accountId: account.id,
        status: "missing",
        message: `No recent .xlsx file found for account id ${account.id}`
      });
      continue;
    }

    const item = {
      account: account.name,
      accountId: account.id,
      date: args.date,
      status: "found",
      file: file.path,
      fileName: basename(file.path),
      size: file.size,
      importName: name
    };

    if (shouldImport) {
      const imported = importToFeishu(file, name, config.feishu || {}, args.dryRun);
      item.import = imported;
      item.status = imported.status === 0 ? "imported" : "import_failed";
    }

    summary.push(item);
  }

  console.log(JSON.stringify({ date: args.date, dryRun: args.dryRun, results: summary }, null, 2));

  if (summary.some((item) => item.status === "missing" || item.status === "import_failed")) {
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
