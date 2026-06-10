---
name: oceanengine-ad-report-downloader
description: Download Ocean Engine/Juliang Marketing advertising reports through Fangzhou service-provider backend and deliver them as Feishu Sheets. Use when the user asks to enter Fangzhou/agent.oceanengine.com, choose 巨量营销广告 accounts, configure 数据 tab 广告报表 dimensions/metrics, download monthly/daily ad report data, save custom report templates, or convert downloaded Excel reports into Feishu Sheets.
---

# Oceanengine Ad Report Downloader

## Scope

Use this skill for 巨量营销广告报表 downloads that start from 方舟 (`agent.oceanengine.com`) and end with a Feishu Sheet deliverable.

Do not use this for 巨量千川 unless the user explicitly switches scope. 千川 paths, account selectors, and data products are separate and must be verified before automation.

## Required Tools

- Use Chrome control for Fangzhou and Ocean Engine because the workflow depends on the user's logged-in Chrome session.
- Use the Feishu drive/sheet skills after download to import the Excel file and return a Feishu Sheet link.
- Keep the raw Excel download as a local backup unless the user asks to delete it.

## Workflow

1. Confirm inputs:
   - Account name and account ID.
   - Date range.
   - Dimensions and metrics. For the default field set, read `references/default-fields.md`.
   - Whether to reuse an existing report, save as a new report, or only download once.

2. Enter through Fangzhou:
   - Open `https://agent.oceanengine.com/`.
   - In 方舟广告投放账户, choose 巨量营销.
   - In 【客户账户】, search/select the target account by account name or ID.
   - Enter the account, then go to 【数据】 -> 【广告报表】.

3. Avoid direct-link blocking:
   - Do not assume direct opening of `ad.oceanengine.com` will work for every account.
   - If direct report URL shows an internal/agent access restriction, go back through Fangzhou.
   - A fallback is: from Fangzhou account project list, open any project detail first, then open the advertising report URL in that authorized Ocean Engine context.

4. Configure the report:
   - Select data topic `基础数据` when the report has no fields or says fields can be added on the right.
   - Add the required dimensions and metrics from the field list.
   - Set the date range explicitly; if using a quick range such as `上月`, verify the concrete start/end dates shown on the page.
   - Query/refresh before download and record visible total rows and key totals when available.

5. Save the template if requested:
   - If normal `保存` fails with `模板不存在`, use `另存为新报表`.
   - Fill `报表名称` exactly as requested by the user.
   - After confirming, verify the new report appears in 【全部报表】. It may be on page 2 or later.

6. Download:
   - Use the page download action and wait for the browser download event.
   - Save the local path, file size, account ID, date range, and visible row count.
   - For Chrome wrapper downloads, use `waitForEvent("download", { timeoutMs: 60000 })`.

7. Convert to Feishu Sheet:
   - Import the downloaded Excel file into Feishu as an online spreadsheet.
   - Return the Feishu Sheet link as the primary deliverable.
   - Mention the local Excel backup path only as supporting information.

8. Report validation:
   - Confirm account name/ID, date range, row count, and download/import status.
   - Call out field gaps instead of silently substituting metrics.

## Field Gaps

The tested 巨量营销广告报表 `基础数据` topic exposes `播放量` and `完播率`, but no independent `完播量` field was found. A similar-looking metric `99%进度播放数` exists, but do not treat it as `完播量` unless the user explicitly approves that substitution.

## Output Format

Keep the user-facing response short:

- Feishu Sheet link.
- Account(s), date range, and row count.
- Any missing/unavailable fields.
- Raw Excel backup path if useful.
