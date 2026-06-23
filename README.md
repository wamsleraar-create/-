# 巨量广告报表 Skill

这是给部门同事安装到 Codex 的巨量营销广告报表下载 skill。

## 安装

把 `oceanengine-ad-report-downloader` 文件夹复制到本机：

```bash
~/.codex/skills/oceanengine-ad-report-downloader
```

然后重启 Codex，或新开一个 Codex 会话。

## 触发方式

可以这样说：

```text
用巨量广告报表，下载巨量营销账户：账户名称，ID xxx，时间 2026 年 5 月，按默认字段，导出为飞书表格
```

## 注意

- 这个 skill 只覆盖巨量营销广告报表。
- 巨量千川需要单独验证流程后再扩展。
- 使用时需要当前 Chrome 已登录方舟和巨量引擎。

## 日报自动化脚本

脚本位置：

```bash
scripts/update-daily-report.mjs
```

使用前复制配置：

```bash
cp config/daily-report.example.json config/daily-report.json
```

把 `config/daily-report.json` 里的账户名称、账户 ID、飞书文件夹 token 改成自己的。

运行：

```bash
node scripts/update-daily-report.mjs --config config/daily-report.json --date 2026-06-22
```

脚本会在下载目录里按账户 ID 找最新的 `.xlsx`，然后通过 `lark-cli drive +import` 导入为飞书表格。
