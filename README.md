# 模型分工

为 DSH 内置 standard / ptc / cordis 预设设置默认执行模型：主 agent 负责规划与审查，普通 `subagent` 可以使用另一个已配置的模型执行任务。管理页还提供版本检查与一键更新。

- 仓库：<https://github.com/WTYJ/dsh-cross-model-subagent>
- 安装包名：`@wtyj/dsh-cross-model-subagent`

## 安装

在 DSH 中通过插件管理安装本仓库：

```sh
dsh plugin add https://github.com/WTYJ/dsh-cross-model-subagent.git
```

也可以在 **Plugins → Add plugin** 中填入同一个 Git 地址。

## 使用

1. 在侧边栏靠上的「模型分工」入口打开设置。
2. 「默认执行模型」设置全局默认；关闭时普通子代理沿用父模型。
3. 「会话模型覆盖」选择一个已有会话，再选择：继承全局、沿用父模型、指定一个模型。保存后，下一次普通 `subagent` 委派读取新默认；不改变已经运行的子代理。
4. 页面另提供新根会话自动开启 Agent Teams，以及对选定已有会话启用/停用 Agent Teams。
5. 页首「刷新」实际请求模型、会话和配置；进入页面自动加载不显示成功提示，手动刷新成功后提示约 3 秒自动消失。拒绝保存和请求失败会明确显示，未保存草稿保留。

管理页按模型设置与团队协作分组，优先展示会话覆盖；布局跟随面板实际宽度（容器查询），宽时并列、窄时单列。会话模式的三项选择以可直接点选的单选项呈现；会话选项附短 ID 区分同名会话，完整 ID 可展开查看；技术说明收在「适用范围与说明」。键盘焦点环、触控点击区域（触屏不小于 48px）与表单错误提示已按无障碍指南处理。

默认模型和“允许 agent 显式选择哪些模型”是不同机制。本插件配置的是工具的用户默认值，不追加、替换或放宽 `subagent/model-selection-policy`。`subagent` 不填 provider/model 时使用本插件默认；显式填写时仍经过原生授权检查。`subagent_fork` 不作覆盖，继续使用原生父模型及上下文继承行为，适合交给主模型审查。

## 检查更新与升级

设置页底部的「版本与更新」会读取公开仓库的最新提交与 `package.json` 版本，并与本地版本比较：

- **有新版本**：显示「安装 vX」。安装走 DSH 插件管理器 `updateBundle`，目标被固定到校验过的那一次提交（`<仓库>#<40 位 commit>`）；失败会回滚到原版本，需要重启时会明确提示。
- **已是最新 / 本地更新**：只显示状态，不提供安装。
- **本地链接安装**（`link:` 或路径安装）：无法原地升级，页面给出一次性的迁移命令；迁移为 Git 安装后即可使用页内一键更新。
- **检查失败**（无网络、API 限流、仓库为空）：显示可读原因，可以重试。

页面通过插件自己的 Host 路由 `POST /model-delegation/update` 调用同一套逻辑：该路由只接受 `check` 与 `apply` 两个动作、限制请求体大小、拒绝跨源请求，并且不携带任何凭据。安装动作同样可以通过工具 `cross_model_subagent_update` 由模型触发。

## 实现与范围

Host 在每个根 agent 的作用域中复用当前 DSH 安装的官方 `@deepseek-ai/dsh-tool-subagent.apply`，通过动态 `agentOptions` 默认值选择工作模型。每次执行读取 volatile 配置，因此已有会话也能修改、清除默认值，不依赖一次性的模型授权事件。子代理的作用域不安装该覆盖。

支持内置 standard / ptc / cordis 的普通 spawn 委派。没有 subagent 工具的预设不会被新增委派能力；其他自定义预设不安装覆盖。自定义后端、独立 worker preset 或自行修改过的 subagent 工具配置不在兼容范围内。主 agent 的模型不会被切换。模型必须在提供方目录中可用；无效模型在委派时由原生预检明确拒绝，不会悄悄改用其他模型。

2.0 保留旧版 `sessionRoutesJson` 数据，但不会将多个授权路由猜测为一个默认模型；请重新选择需要的会话默认模型。原生全局授权设置继续由 DSH 自带设置页管理。

## 工具

- `cross_model_subagent_status`：查看根会话默认模型、原生工具覆盖是否已挂载、调用时机，以及独立的显式模型授权信息。可提供 sessionId 检查其他会话。
- `cross_model_subagent_configure`：scope 为 global 或 session；mode 为 route、parent，或仅会话适用的 inherit。route 需要精确 provider/model。会话省略 sessionId 时操作当前子代理树的根会话。保存经过配置编辑器和实时目录校验，失败返回原因。
- `cross_model_subagent_update`：`action: check` 读取版本状态；`action: apply` 传入检查得到的 `version` 与 pinned `spec` 安装新版本。

## 验证

`tests/routing.test.mjs` 覆盖配置选择、修改、清除和旧数据处理；`tests/host-integration.test.mjs` 使用实际 Cordis、工具注册表和官方委派代码，控制外部 LLM/activation 边界，验证已有会话实时切换、显式授权、fork 不变和卸载恢复；`tests/updating.test.mjs` 与 `tests/host-update.test.mjs` 覆盖版本比较、Git 副本判定、空仓库与网络失败分支；`tests/catalog-validation.test.mjs` 覆盖模型目录校验；`client-data.test.mjs` 测试前端纯数据逻辑。前两组需要 DSH 安装运行时（`ELECTRON_RUN_AS_NODE=1` 的安装可执行文件），GitHub Actions 里只跑不依赖安装的三组。

外部模型真实调用、真实 GitHub 往返与真实页面视觉应分别验证，安装成功不等于这些验证已完成。

修改已有安装后，应使用插件管理器重新加载模块并刷新当前 DSH 页面。没有浏览器控制时，不宣称已验证深浅色画面或实际滚动。
