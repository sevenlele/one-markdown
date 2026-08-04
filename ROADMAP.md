# OneMarkdown — Roadmap

> Open, write, publish. One file is all you need.

## Vision

成为最好的"单文件工作流"Markdown 编辑器——打开就能写，写完就能发，AI 随叫随到。

目标用户：技术博客作者、API 文档写作者、开发者、技术自媒体。

---

## Phase 0: Foundation（本周 / v0.1.1）

> 修掉阻塞性问题，让产品基本可用。

- [x] 项目初始化 + GitHub Actions CI/CD
- [ ] **P0: SyntaxSet 全局缓存**（每次渲染重新加载 3MB → 初始化一次）
- [ ] **P0: 异步命令**（文件 I/O 和 AI 调用阻塞 UI → async + tokio::fs）
- [ ] **P1: 撤销/重做保护**（wrap/insertAtCursor 摧毁 textarea undo 栈）
- [ ] **P1: 关闭未保存提醒**
- [ ] **P1: API Key 安全存储**（OS Keychain 或加密）
- [ ] **P1: CSP 安全策略收紧**
- [ ] 修复 frontmatter 解析边界情况（`\n---\n` 而非 `\n---`）

**发布：** v0.1.1 patch release

---

## Phase 1: Core Editor（2-3 周 / v0.2.0）

> 把编辑器做到"日常能用"的水平。

### 必须有
- [x] 搜索/替换（Ctrl+F / Ctrl+H）— 支持正则
- [x] 文件外部变更检测（`notify` 已在依赖，接入即可）
- [x] 拖拽打开文件
- [x] 最近文件列表 UI（数据已有，缺前端）
- [x] 设置面板 UI（AI 配置 / 图片策略 / 编辑器设置）
- [x] 浅色主题 + 主题切换
- [x] 自动保存（可配置间隔）
- [x] Markdown 快捷键增强：
  - [ ] 自动补全括号/引号
  - [x] 列表自动延续（回车自动加 `- `）
  - [x] Tab 缩进选中行

### 应该有
- [x] 字数/阅读时间估算
- [ ] 文件树侧边栏（可选显示）
- [x] 打印支持 (Ctrl+P)
- [ ] 快捷键自定义

**发布：** v0.2.0 minor release + Hacker News / V2EX 发布

---

## Phase 2: AI Power（2-3 周 / v0.3.0）

> 把 AI 做成核心卖点，不是附属功能。

### AI 功能增强
- [x] 流式输出（SSE）— AI 回复实时显示，不卡 UI
- [x] AI 内联编辑 — 选中文字，按快捷键，AI 直接替换选中内容
- [ ] AI 续写 — 光标处按 Tab，AI 自动续写下文
- [ ] AI 对话模式 — 侧边栏多轮对话，可引用文档上下文
- [x] 支持更多 AI 后端：
  - [x] OpenAI / Claude / Gemini（通过兼容 API）
  - [x] Ollama 本地模型（自动检测）
  - [x] 自定义 endpoint
- [ ] Context Bundle 增强：
  - [ ] 支持引用多个文件
  - [ ] 支持添加 URL 网页内容
  - [ ] Token 计数估算
- [ ] AI 使用统计（token 消耗 / 费用估算）

### 安全
- [ ] API Key 存储迁移到 OS Keychain
- [x] AI 请求脱敏日志

**发布：** v0.3.0 + Product Hunt 发布

---

## Phase 3: Rich Content（3-4 周 / v0.4.0）

> 让 OneMarkdown 能写"复杂文档"。

- [x] 数学公式（KaTeX）— `$...$` 和 `$$...$$`
- [x] Mermaid 图表 — 流程图/时序图/甘特图
- [x] Callouts / Admonitions — `> [!note]` `> [!warning]`
- [x] 脚注支持
- [x] 目录生成（`[toc]` 或 frontmatter 控制）
- [ ] 图片管理器：
  - [x] 粘贴/拖拽图片自动处理
  - [ ] 图片压缩（可选）
  - [ ] 图片库浏览
- [ ] 导出增强：
  - [x] PDF 导出（通过打印 Ctrl+P）
  - [ ] DOCX 导出（通过 pandoc 集成）
  - [ ] 自定义 HTML 模板

**发布：** v0.4.0

---

## Phase 4: Ecosystem（1-2 月 / v0.5.0）

> 建立可持续的社区和生态。

### 插件系统
- [ ] 插件 API 设计（JavaScript/TypeScript）
- [ ] 插件沙箱（安全隔离）
- [ ] 插件市场（社区贡献）
- [ ] 内置插件示例：
  - 自定义快捷键
  - 自定义渲染器
  - 自定义导出格式
  - AI prompt 模板

### 社区
- [ ] 文档站点（VitePress / Docusaurus）
- [ ] 贡献指南
- [ ] Issue 模板
- [ ] Discussion 论坛
- [ ] Discord / Telegram 社群

### 平台
- [ ] macOS 原生菜单栏集成
- [ ] Windows 任务栏集成
- [ ] Linux 系统托盘
- [ ] 自动更新机制

**发布：** v0.5.0 + 正式社区运营

---

## Phase 5: Mobile & Sync（2-3 月 / v1.0）

> 跨设备，数据同步。

### 移动端
- [ ] iOS（Tauri Mobile）
- [ ] Android（Tauri Mobile）
- [ ] 移动端 UI 适配（触屏优化）
- [ ] 分享扩展（从其他应用发送 Markdown 到 OneMarkdown）

### 同步
- [ ] 本地文件系统同步（iCloud / OneDrive / Dropbox）
- [ ] Git 同步（可选）
- [ ] 端到端加密云同步（付费功能）
- [ ] 冲突解决 UI

### 商业化
- [ ] 免费核心 + 付费云同步
- [ ] 企业版（团队协作 / 权限管理）
- [ ] Sponsor / GitHub Sponsors

**发布：** v1.0 🎉

---

## Release Cadence

| 阶段 | 版本 | 周期 | 重点 |
|------|------|------|------|
| Patch | v0.1.x | 1-2 天 | Bug 修复 |
| Minor | v0.2.0 - v0.5.0 | 2-4 周 | 新功能 |
| Major | v1.0 | 3-6 月 | 移动端 + 同步 |

## Guiding Principles

1. **单文件是核心** — 永远不要加 Vault/项目管理，一个 .md 就是全部
2. **AI 是一等公民** — 不是插件，是内置能力
3. **快是底线** — 冷启动 <100ms，渲染 <50ms，AI 流式输出
4. **隐私优先** — 本地优先，云端可选，数据用户掌控
5. **开源是承诺** — MIT 协议，核心功能永不闭源
