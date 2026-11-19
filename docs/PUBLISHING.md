# 上传到 GitHub 并启用页内更新

本目录就是一个完整的 DSH 插件包（仓库根目录 = 包根目录），可以直接推送到 <https://github.com/WTYJ/dsh-cross-model-subagent>。

## 1. 首次推送

仓库目前是空的，`main` 分支需要先有一个提交，页内更新才能读到版本。

```powershell
cd "C:\Users\MR\Desktop\dsh团队协作\dsh-cross-model-subagent"
git init -b main
git add .
git commit -m "feat: cross-model worker defaults with in-page updates"
git remote add origin https://github.com/WTYJ/dsh-cross-model-subagent.git
git push -u origin main
```

`git add .` 会包含 `tests/` 与 `scripts/`。安装时 pnpm 只取 `files` 列出的运行时文件，测试脚本不会进入用户安装。

## 2. 每次发布新版本

版本号必须和提交一起移动，否则已安装的副本会一直报告旧版本，页内更新也拿不到可固定的提交。

```powershell
node scripts/release.mjs patch --push     # 或 minor / major / 2.2.0
```

脚本会：检查工作区干净 → 语法检查 → 跑全部测试 → 修改 `package.json` 版本 → 提交 → 打 `v<version>` 标签 → 推送提交和标签。

## 3. 用户如何安装与更新

**首次安装**（任选其一）：

```sh
dsh plugin add https://github.com/WTYJ/dsh-cross-model-subagent.git
```

或 **Plugins → Add plugin** 填入同一个地址。

**后续更新**：打开「模型分工」设置页底部的「版本与更新」，页面自动读取仓库最新提交与版本号；显示新版本时点「安装 vX」。安装由 DSH 插件管理器执行，目标固定到检查过的那一次提交，失败会回滚，需要重启时页面会说明。

## 4. 从本地链接安装迁移

`link:` 或路径安装的副本无法原地升级。迁移一次即可：

1. 在 **Plugins** 中移除原来的本地安装（或 `dsh plugin remove @local/dsh-cross-model-subagent`）。
2. 用上面的 Git 地址重新安装。
3. 之后页内「版本与更新」可以直接一键升级。

包名已从 `@local/dsh-cross-model-subagent` 改为 `@wtyj/dsh-cross-model-subagent`，迁移后原配置文件 `cordis.patch.yml` 里的行 id（`cross-model-subagent`）保持不变，配置值仍会被读取；如 Profile 里残留旧行，请一并删除。

## 5. 更新接口的行为边界

- 页面调用同源路由 `POST /model-delegation/update`，支持 `check` 和 `apply`，限制请求体大小为 8 KiB，并拒绝跨源请求。
- `apply` 通过 DSH Connection 验证当前连接的所有者权限。桌面端和 Web 界面会自动携带已有凭据。检查版本继续支持无需凭据的请求。
- `check` 读取 `api.github.com` 的最新提交与 `raw.githubusercontent.com` 的 `package.json`，两个请求都有超时与 1 MiB 响应上限；失败只报告原因，不抛异常。
- `apply` 只接受「版本号 + 固定到 40 位 commit 的仓库地址」；提交必须属于本仓库，否则拒绝。
- 安装、回滚、重启判定全部由 DSH `pluginManager.updateBundle` 负责，插件不直接改写 Profile 文件。
- 更新页依赖 DSH 的 `pluginManager` 和 `webServer` 服务。通过页面安装更新还需要 `connection` 提供身份校验。
