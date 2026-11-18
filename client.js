window.__ModuleLoader__.load({
  id: '@wtyj/dsh-cross-model-subagent',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback, useMemo, useRef, useId } = React
    const NS = 'crossModelSubagent'
    const CONFIG = 'cross-model-subagent'
    // Scoped class prefix: every selector below is nested under this id so nothing leaks to the DSH shell.
    const ROOT = 'cms-panel'

    // Pure data helpers; the dedicated tests evaluate only this block, without React or DOM.
    // BEGIN PURE HELPERS
    const routeKey = (route) => JSON.stringify([route.provider || '', route.model || ''])
    function routeFromKey(key) {
      const [provider, model] = JSON.parse(key)
      return { provider, model }
    }
    function sessionRows(snapshot) {
      if (!snapshot || !snapshot.ids || !snapshot.byId) return []
      return snapshot.ids.map(id => snapshot.byId[id])
        .filter(row => row && row.origin !== 'subagent' && typeof row.id === 'string')
        .map(row => ({ id: row.id, title: row.displayTitle || row.title || row.id,
          current: (row.retainedBy && row.retainedBy.mainView || 0) > 0 }))
    }
    function defaultValue(value) {
      return { routingEnabled: value.routingEnabled === true,
        defaultProvider: value.defaultProvider || '', defaultModel: value.defaultModel || '' }
    }
    function sessionValue(value, id) {
      const entry = (value.sessionDefaults || []).find(row => row.sessionId === id)
      return entry ? { mode: entry.mode, provider: entry.provider || '', model: entry.model || '' }
        : { mode: 'inherit', provider: '', model: '' }
    }
    function replaceSession(entries, id, next) {
      const rest = (entries || []).filter(row => row.sessionId !== id)
      return next.mode === 'inherit' ? rest : rest.concat([{ sessionId: id, mode: next.mode,
        provider: next.mode === 'route' ? next.provider : '', model: next.mode === 'route' ? next.model : '' }])
    }
    function beginEdit(previous, value, revision, next) {
      const baseline = previous ? previous.baseline : value
      if (JSON.stringify(next) === JSON.stringify(baseline)) return null
      return { baseline, revision: previous ? previous.revision : revision, value: next }
    }
    const isDirty = (edit) => !!edit && JSON.stringify(edit.value) !== JSON.stringify(edit.baseline)
    const acceptedWrite = (result) => result === true
    // END PURE HELPERS

    const dict = {
      zh: {
        panelTitle: '模型分工', panelIcon: '模型分工',
        intro: '为原生 subagent 委派安排执行模型：主模型负责规划与审查，执行模型完成任务。',
        roleMain: '主模型', roleMainHint: '负责规划、拆分任务与审查结果。',
        roleFlow: '规划审查 → 委派执行',
        roleWorker: '执行模型', roleWorkerHint: '按规划完成具体任务。',
        rolesTitle: '分工概览',
        colSession: '会话覆盖（优先）', colGlobal: '全局默认（次级）',
        globalTitle: '全局默认执行模型', globalHint: '用于没有会话覆盖的原生 subagent 委派。',
        enable: '使用指定的默认子agent模型', off: '全局默认关闭：沿用父agent模型。', model: '默认子agent模型',
        sessionTitle: '会话模型覆盖', sessionHint: '为所选会话的后续原生委派指定单个执行模型；会话覆盖优先于全局默认。',
        optional: '可选',
        target: '目标会话', mode: '会话模型模式', inherit: '继承全局默认（清除会话覆盖）', parent: '沿用父agent模型', route: '指定一个模型',
        sessionModel: '该会话的子agent模型', inheritHint: '清除覆盖后，这个会话将使用全局默认；全局关闭时沿用父模型。',
        parentHint: '这个会话始终沿用父agent模型，即使全局指定了默认模型。', routeHint: '这个会话使用下面的模型，即使全局默认关闭。',
        modeHelp: '三选一：继承全局默认、沿用父agent模型，或指定一个模型。本组任一选择都不会自动提交。',
        effective: '当前已保存的行为：', noSession: '暂无可选会话。请先创建或打开会话，再刷新。', current: '当前会话',
        sessionLoading: '正在加载会话…', missingSession: '所选会话已不在可用列表中。草稿保留，请撤销后重新选择。',
        selectedIdLabel: '所选会话 ID', copyId: '复制', copied: '已复制', copyFailed: '复制失败，可直接选取会话 ID 文本。',
        teamsTitle: '团队协作', teamsHint: '新会话默认与已有会话分别控制是否启用 Agent Teams。',
        forceTitle: '新会话默认', forceHint: '开启后，新建的根会话自动启用 Agent Teams。', forceLabel: '新建会话自动启用团队协作',
        teamsExistingTitle: '已有会话', teamsTarget: '团队协作目标会话',
        teamsEnable: '启用团队协作', teamsDisable: '停用团队协作', teamsEnabled: '已为所选会话启用团队协作。', teamsDisabled: '已为所选会话停用团队协作。',
        teamsUnknown: '操作会应用到所选会话，状态以所选会话为准；操作结果显示在下方。',
        save: '保存', saving: '保存中…', discard: '撤销草稿', saved: '已保存', working: '处理中…',
        dirty: '有未保存的修改。', switchProtected: '请先保存或撤销草稿，再切换目标会话。',
        refused: 'Host 未接受保存（可能是配置已改变或验证失败）。草稿已保留，请刷新后核对。',
        conflict: '配置在编辑后已改变。草稿仍按编辑起点的 revision 保存，避免覆盖他人的修改。',
        rebase: '保留草稿并采用最新配置版本', rebased: '已采用最新版本，请核对草稿后重新保存。',
        refreshAction: '刷新', refresh: '刷新模型、会话和配置', refreshing: '正在刷新…', refreshed: '模型、会话和配置已刷新。', refreshFailed: '部分刷新失败；保留上次可用数据：',
        configLoading: '正在加载配置…', unavailable: 'Host 未提供此插件配置，无法编辑。', readOnly: '当前配置为只读，无法保存。',
        modelsLoading: '正在加载模型目录…', modelsEmpty: '没有可用模型。请检查提供方配置后刷新。',
        stale: '不在当前模型目录中（已保留）', staleHint: '当前选中的路由不在目录中。可保留草稿；选择可用模型后才能保存新的路由设置。',
        choose: '请选择一个模型', needModel: '请选择一个当前目录中的模型。', partial: '部分提供方加载失败：',
        error: '操作失败', sessions: '会话', models: '模型', config: '配置', retry: '重试刷新',
        details: '适用范围与说明',
        scopeHint: '支持 DSH 内置 standard / ptc / cordis 预设。保存后，主agent 下一次普通 subagent 委派使用新默认模型。subagent_fork 保持原生模型与缓存语义；显式指定模型仍受原生授权策略约束。',
        legacy: '检测到旧版会话授权数据。授权名单不会自动转换为默认模型，请在下方为需要的会话重新选择执行模型。',
        updateTitle: '版本与更新', updateHint: '检查此插件在 GitHub 上的公开发布，并可从页面内一步安装新版本。',
        updateCurrentVersion: '当前版本', updateLatestVersion: '最新版本', updateStatus: '状态', updateCheckedAt: '上次检查',
        updateVersionUnknown: '未知', updateVersionPending: '检查中',
        updateChecking: '正在检查更新…', updateCheckingShort: '正在检查…', updateCheckFailed: '无法检查更新。',
        updateCheckedNever: '尚未检查',
        updateBadgeReady: '可发现新版本', updateBadgeUpToDate: '已是最新', updateBadgeAhead: '当前本地版本更新',
        updateEmptyNote: '仓库还没有任何提交，因此暂时无法比较版本；推送第一个版本后再检查即可。',
        updateBadgeUnknown: '无法比较版本', updateBadgeEmpty: '仓库尚无提交', updateBadgeError: '检查失败',
        updateNotes: '更新说明：',
        updateAheadNote: '本地版本比 GitHub 上的发布更新（可能是本地改动或未发布的提交）。无需更新。',
        updateUnknownNote: '无法比较版本：当前或最新版本不是有效的语义化版本号。',
        updateInstallButton: '安装 v{version}', updateRecheck: '重新检查', updateRetry: '重试检查',
        updateConfirmQuestion: '确认安装 v{version}？安装后按提示可能需要重启 DSH。',
        updateConfirmInstall: '确认安装', updateCancelConfirm: '取消',
        updateInstalling: '正在安装…', updateApplied: '更新已安装并已生效。',
        updateRestartRequired: '更新已安装，需要重启 DSH 以加载新版本。',
        updateFailedCancelled: '更新失败或已取消。', updateRestored: '已回滚到旧版本（{version}）。',
        updateMigrateIntro: '当前为本地链接或路径安装，无法在原地升级。请改用 Git 安装以使用页面内一键更新。',
        updateMigrateAfter: '迁移到 Git 安装后，回到本页即可直接一键更新。',
        updateNotInstalled: '没有从插件管理器找到这份插件的安装记录，因此无法在页面内检查更新。',
        copyCommand: '复制命令', copyFailedManual: '复制失败，请手动选取命令文本复制。',
        updateNetworkError: '网络错误，无法连接更新接口。', updateHttpError: '更新接口返回错误（HTTP {status}）。',
        updateBadResponse: '更新接口返回了无法解析的响应。',
      },
      en: {
        panelTitle: 'Model delegation', panelIcon: 'Model delegation',
        intro: 'Plan the execution model for native subagent delegations: the main model plans and reviews, the worker model does the task.',
        roleMain: 'Main model', roleMainHint: 'Plans, splits tasks, and reviews results.',
        roleFlow: 'Plan & review → delegate',
        roleWorker: 'Worker model', roleWorkerHint: 'Completes the assigned task.',
        rolesTitle: 'Delegation overview',
        colSession: 'Session override (primary)', colGlobal: 'Global default (secondary)',
        globalTitle: 'Global default worker model', globalHint: 'Used for native subagent delegations without a session override.',
        enable: 'Use a specified default subagent model', off: 'Global default is off: use the parent model.', model: 'Default subagent model',
        sessionTitle: 'Session model override', sessionHint: 'Set one worker model for the selected session’s next native delegations; a session override takes priority over the global default.',
        optional: 'optional',
        target: 'Target session', mode: 'Session model mode', inherit: 'Inherit global default (clear override)', parent: 'Use parent model', route: 'Specify one model',
        sessionModel: 'Subagent model for this session', inheritHint: 'Clearing the override restores the global default, or the parent model when the global default is off.',
        parentHint: 'This session uses the parent model even when a global default is specified.', routeHint: 'This session uses the model below even when the global default is off.',
        modeHelp: 'Choose one of three: inherit the global default, use the parent model, or specify one model. Selecting any option never auto-submits.',
        effective: 'Currently saved behavior: ', noSession: 'No sessions available. Create or open a session, then refresh.', current: 'Current session',
        sessionLoading: 'Loading sessions…', missingSession: 'The selected session is no longer available. The draft is retained; discard it to select another session.',
        selectedIdLabel: 'Selected session ID', copyId: 'Copy', copied: 'Copied', copyFailed: 'Copy failed. Select the session ID text to copy it manually.',
        teamsTitle: 'Agent Teams', teamsHint: 'Control Agent Teams separately for new sessions and existing sessions.',
        forceTitle: 'New sessions', forceHint: 'Automatically enable Agent Teams for newly created root sessions.', forceLabel: 'Enable Agent Teams automatically for new sessions',
        teamsExistingTitle: 'Existing session', teamsTarget: 'Agent Teams target session',
        teamsEnable: 'Enable Agent Teams', teamsDisable: 'Disable Agent Teams', teamsEnabled: 'Agent Teams enabled for the selected session.', teamsDisabled: 'Agent Teams disabled for the selected session.',
        teamsUnknown: 'The action applies to the selected session; its state follows that session. The result appears below.',
        save: 'Save', saving: 'Saving…', discard: 'Discard draft', saved: 'Saved', working: 'Working…',
        dirty: 'Unsaved changes.', switchProtected: 'Save or discard the draft before switching sessions.',
        refused: 'The Host refused the save (configuration may have changed or validation failed). Your draft is retained; refresh and review it.',
        conflict: 'Configuration changed after editing began. The draft retains its original revision to prevent overwriting other changes.',
        rebase: 'Keep draft and adopt latest configuration revision', rebased: 'Latest revision adopted. Review the draft before saving again.',
        refreshAction: 'Refresh', refresh: 'Refresh models, sessions and configuration', refreshing: 'Refreshing…', refreshed: 'Models, sessions and configuration refreshed.', refreshFailed: 'Some refreshes failed; last available data retained: ',
        configLoading: 'Loading configuration…', unavailable: 'The Host does not serve this plugin configuration.', readOnly: 'Configuration is read-only; saving is disabled.',
        modelsLoading: 'Loading model catalog…', modelsEmpty: 'No models available. Check provider configuration, then refresh.',
        stale: 'Not in the current catalog (retained)', staleHint: 'The selected route is absent from the catalog. Your draft is retained; select an available model to save new route settings.',
        choose: 'Choose one model', needModel: 'Choose one model from the current catalog.', partial: 'Some providers failed to load: ',
        error: 'Operation failed', sessions: 'Sessions', models: 'Models', config: 'Configuration', retry: 'Retry refresh',
        details: 'Scope & notes',
        scopeHint: 'Supports the shipped standard / ptc / cordis presets. Saved worker defaults apply to the parent agent’s next ordinary subagent delegation. subagent_fork keeps its native model and cache behavior; explicit model choices still follow native authorization.',
        legacy: 'Legacy session authorization data was found. Allowlists are not converted into a default model; choose a worker model again for the relevant sessions.',
        updateTitle: 'Version & updates', updateHint: 'Check this plugin’s public GitHub release and install a newer version in one step from this page.',
        updateCurrentVersion: 'Current version', updateLatestVersion: 'Latest version', updateStatus: 'Status', updateCheckedAt: 'Last checked',
        updateVersionUnknown: 'Unknown', updateVersionPending: 'Checking',
        updateChecking: 'Checking for updates…', updateCheckingShort: 'Checking…', updateCheckFailed: 'Could not check for updates.',
        updateCheckedNever: 'Not checked yet',
        updateBadgeReady: 'New version available', updateBadgeUpToDate: 'Up to date', updateBadgeAhead: 'Local version is newer',
        updateEmptyNote: 'The repository has no commits yet, so there is no version to compare against. Check again after the first release is pushed.',
        updateBadgeUnknown: 'Cannot compare versions', updateBadgeEmpty: 'No commits published yet', updateBadgeError: 'Check failed',
        updateNotes: 'Release notes: ',
        updateAheadNote: 'The local version is newer than the published release (local changes or an unreleased commit). No update is needed.',
        updateUnknownNote: 'Cannot compare versions: the current or latest version is not a valid semantic version.',
        updateInstallButton: 'Install v{version}', updateRecheck: 'Check again', updateRetry: 'Retry check',
        updateConfirmQuestion: 'Install v{version}? DSH may need a restart afterward.',
        updateConfirmInstall: 'Confirm install', updateCancelConfirm: 'Cancel',
        updateInstalling: 'Installing…', updateApplied: 'The update is installed and active.',
        updateRestartRequired: 'The update is installed; restart DSH to load the new version.',
        updateFailedCancelled: 'The update failed or was cancelled.', updateRestored: 'The previous version was restored ({version}).',
        updateMigrateIntro: 'This copy is installed from a local link or path, so it cannot be upgraded in place. Switch to a Git install to enable one-click updates on this page.',
        updateMigrateAfter: 'After migrating to a Git install, come back here to update in one click.',
        updateNotInstalled: 'No installation of this plugin was found through the plugin manager, so updates cannot be checked from this page.',
        copyCommand: 'Copy command', copyFailedManual: 'Copy failed. Select the command text and copy it manually.',
        updateNetworkError: 'Network error: could not reach the update endpoint.', updateHttpError: 'The update endpoint returned an error (HTTP {status}).',
        updateBadResponse: 'The update endpoint returned an unreadable response.',
      },
    }
    // Verified theme tokens used across installed host components, present in both theme branches.
    const C = {
      text: 'var(--dsw-alias-label-primary)', muted: 'var(--dsw-alias-label-secondary)',
      faint: 'var(--dsw-alias-label-secondary)', caption: 'var(--dsw-alias-label-secondary)',
      border: 'var(--dsw-alias-border-l2)', borderSoft: 'var(--dsw-alias-border-l1)',
      surface: 'var(--dsw-alias-bg-layer-1)', surfaceAlt: 'var(--dsw-alias-bg-layer-2)',
      fill: 'var(--dsw-alias-bg-layer-2)', primary: 'var(--dsw-alias-brand-primary)',
      onPrimary: 'var(--dsw-alias-label-primary-inverted)', error: 'var(--dsw-alias-state-error-primary)',
      ok: 'var(--dsw-alias-state-success-primary)',
      warn: 'var(--dsw-alias-state-warn-primary)', focus: 'var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary))',
    }
    // Inline styles carry layout that must not depend on the query, plus the theme tokens that
    // come from CSS variables. The container query rules and focus/hover/live behaviors live in
    // the scoped <style> block rendered inside the panel (see PANEL_CSS), scoped under #ROOT.
    const S = {
      wrap: { flex: '1 1 auto', minHeight: 0, height: '100%', width: '100%', overflowY: 'auto',
        scrollbarGutter: 'stable', overscrollBehavior: 'contain',
        boxSizing: 'border-box', color: C.text },
      inner: { maxWidth: 1120, margin: '0 auto', padding: '24px 24px', paddingInline: 'clamp(12px, 4cqi, 24px)',
        paddingTop: 'calc(24px + var(--dsh-frame-leading-clearance, 0px))', boxSizing: 'border-box' },
      header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', margin: '0 0 20px' },
      headerText: { minWidth: 0, flex: '1 1 260px' },
      title: { fontSize: 20, fontWeight: 600, margin: '0 0 6px', lineHeight: 1.3 },
      sub: { fontSize: 13, color: C.muted, lineHeight: 1.6, margin: 0, overflowWrap: 'anywhere' },
      iconBtn: { flex: '0 0 auto', display: 'inline-flex', alignItems: 'center', gap: 6, borderRadius: 8, padding: '7px 10px', border: '1px solid ' + C.border, background: C.fill, color: C.text, fontSize: 13, cursor: 'pointer', lineHeight: 1, whiteSpace: 'nowrap' },
      // Both grids are class-only; their column counts are set in PANEL_CSS via container queries
      // so the layout follows the panel's real width, not the viewport. Columns stretch so two cards
      // of different heights end on the same line instead of leaving a ragged edge.
      grid: { display: 'grid', gap: 16, alignItems: 'stretch' },
      group: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 },
      groupTitle: { fontSize: 12, fontWeight: 600, letterSpacing: 0.4, textTransform: 'uppercase', color: C.faint, margin: 0 },
      // The column wrapper fills the stretched row so its single card can absorb the height gap.
      cards: { display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0, flex: '1 1 auto' },
      // Height comes from the grid's stretch, not from flex growth: a card alone in its own row
      // keeps its natural height instead of being inflated to the panel width's row.
      card: { minWidth: 0, border: '1px solid ' + C.borderSoft, borderRadius: 12, padding: 20, background: C.surface, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', flex: '0 1 auto' },
      cardFeature: { borderColor: C.border, background: C.surface },
      // Absorbs leftover height inside the card so the action footer rests on its bottom edge.
      cardBody: { display: 'flex', flexDirection: 'column', flex: '1 1 auto', minWidth: 0 },
      headRow: { display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 6px' },
      heading: { fontSize: 15, fontWeight: 600, margin: 0, minWidth: 0 },
      tag: { flex: '0 0 auto', fontSize: 11, fontWeight: 500, padding: '1px 7px', borderRadius: 999, border: '1px solid ' + C.borderSoft, color: C.muted, background: C.fill, lineHeight: 1.6 },
      hint: { fontSize: 13, color: C.muted, lineHeight: 1.6, margin: '0 0 12px', overflowWrap: 'anywhere' },
      body: { marginTop: 4 },
      row: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '12px 0' },
      field: { display: 'grid', gap: 6, fontSize: 13, margin: '12px 0', minWidth: 0 },
      select: { width: '100%', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box', borderRadius: 8, border: '1px solid ' + C.border, padding: '9px 10px', color: C.text, background: C.surface, font: 'inherit', fontSize: 'max(1rem, 1em)' },
      button: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 8, padding: '8px 12px', border: '1px solid ' + C.border, background: C.fill, color: C.text, fontSize: 13, cursor: 'pointer', maxWidth: '100%', whiteSpace: 'normal', lineHeight: 1.2, minBlockSize: 32 },
      primary: { background: C.primary, color: C.onPrimary, borderColor: C.primary },
      disabled: { opacity: 0.5, cursor: 'not-allowed' },
      note: { display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 10px', fontSize: 13, lineHeight: 1.6, background: C.fill, borderRadius: 8, margin: '10px 0', overflowWrap: 'anywhere' },
      noteError: { borderLeft: '3px solid ' + C.error },
      noteOk: { borderLeft: '3px solid ' + C.ok },
      // The footer stays at the card's bottom edge: its margin pushes it down once the body has
      // grown, so save/discard rows line up across two columns of different heights.
      // Actions rest on the card's bottom edge once the body has absorbed the row's extra height.
      footer: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 'auto', paddingTop: 16 },
      // Same row of buttons when nothing should be pushed down (the update card's lone action row).
      actionRow: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', paddingTop: 16 },
      roles: { display: 'grid', gap: 12, margin: '0 0 20px' },
      roleBox: { display: 'flex', gap: 10, alignItems: 'flex-start', border: '1px solid ' + C.borderSoft, borderRadius: 10, padding: 14, background: C.surface, minWidth: 0 },
      roleIcon: { flex: '0 0 auto', color: C.muted, marginTop: 1 },
      roleName: { fontSize: 13, fontWeight: 600, margin: '0 0 2px' },
      roleHint: { fontSize: 12, color: C.muted, lineHeight: 1.5, margin: 0, overflowWrap: 'anywhere' },
      flow: { flex: '0 0 auto', alignSelf: 'center', color: C.caption, fontSize: 12, whiteSpace: 'nowrap' },
      switchLabel: { display: 'inline-flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13, lineHeight: 1.5, margin: '4px 0', minBlockSize: 24, minInlineSize: 24 },
      checkbox: { width: 18, height: 18, accentColor: C.primary, flex: '0 0 auto', cursor: 'pointer', margin: 0 },
      // radio group for the 3-way session mode
      radioGroup: { border: '1px solid ' + C.borderSoft, borderRadius: 10, padding: '10px 12px', margin: '12px 0', minWidth: 0 },
      radioLegend: { fontSize: 13, fontWeight: 600, padding: '0 4px', color: C.text },
      radioRow: { display: 'flex', alignItems: 'flex-start', gap: 10, padding: '6px 0', minWidth: 0 },
      radio: { width: 18, height: 18, accentColor: C.primary, flex: '0 0 auto', cursor: 'pointer', margin: '2px 0 0' },
      radioLabel: { display: 'flex', flexDirection: 'column', gap: 2, cursor: 'pointer', fontSize: 13, lineHeight: 1.5, minWidth: 0 },
      radioHint: { fontSize: 12, color: C.muted, lineHeight: 1.5, overflowWrap: 'anywhere' },
      details: { marginTop: 8, border: '1px solid ' + C.borderSoft, borderRadius: 8, padding: '8px 12px', background: C.surface },
      summary: { cursor: 'pointer', fontSize: 13, color: C.muted, fontWeight: 500, minBlockSize: 24 },
      detailsBody: { fontSize: 12.5, color: C.muted, lineHeight: 1.6, margin: '8px 0 2px', overflowWrap: 'anywhere' },
      meta: { fontSize: 12, color: C.faint, margin: '4px 0 0', overflowWrap: 'anywhere' },
      copyRow: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', margin: '6px 0 0' },
      code: { fontFamily: 'var(--dsw-font-family)', fontSize: 12, color: C.faint, background: C.fill, borderRadius: 6, padding: '4px 8px', overflowWrap: 'anywhere', wordBreak: 'break-all', minWidth: 0, flex: '1 1 140px' },
      copyBtn: { flex: '0 0 auto', borderRadius: 6, padding: '3px 8px', border: '1px solid ' + C.border, background: C.surface, color: C.muted, fontSize: 12, cursor: 'pointer', lineHeight: 1.4, minBlockSize: 24, minInlineSize: 24 },
      effective: { fontSize: 12.5, color: C.muted, margin: '12px 0 0', overflowWrap: 'anywhere' },
      icon: { flex: '0 0 auto' },
      // Version & update block: label/value rows, install confirm region, notes and migration.
      versionRow: { display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', margin: '4px 0', minWidth: 0 },
      // The four version rows form one block; spacing above comes from the card hint alone.
      versionBlock: { margin: 0 },
      versionLabel: { flex: '0 0 auto', minWidth: 92, fontSize: 12.5, color: C.muted },
      versionValue: { minWidth: 0, flex: '1 1 auto', fontSize: 13, color: C.text, overflowWrap: 'anywhere' },
      updateNotes: { fontSize: 12.5, color: C.muted, lineHeight: 1.6, margin: '10px 0 0', padding: '8px 10px', background: C.fill, borderRadius: 8, overflowWrap: 'anywhere' },
      confirmBox: { flex: '1 1 260px', minWidth: 0, border: '1px solid ' + C.border, borderRadius: 8, padding: '10px 12px', background: C.surfaceAlt, margin: '4px 0' },
      confirmQuestion: { fontSize: 13, margin: '0 0 8px', lineHeight: 1.5, overflowWrap: 'anywhere' },
      migrateBox: { margin: '12px 0 0', minWidth: 0 },
    }

    // Scoped stylesheet rendered as a React element inside the panel. Every selector is nested
    // under #ROOT so nothing reaches the DSH shell; no global element/body/root rules and no
    // external CSS assets. Container queries adapt to the panel's own width (not 4vw viewport).
    const PANEL_CSS = `
#${ROOT} {
  container-type: inline-size;
  container-name: cms;
  min-inline-size: 0;
  overflow-wrap: anywhere;
}
#${ROOT} .cms-inner { min-inline-size: 0; }
#${ROOT} .cms-title { text-wrap: balance; }
#${ROOT} .cms-card-heading { text-wrap: balance; }
#${ROOT} .cms-sub, #${ROOT} .cms-hint, #${ROOT} .cms-details-body, #${ROOT} .cms-radio-hint,
#${ROOT} .cms-role-hint, #${ROOT} .cms-note, #${ROOT} .cms-effective { text-wrap: pretty; }
#${ROOT} .cms-inner * { min-inline-size: 0; }
#${ROOT} .cms-longid { overflow-wrap: anywhere; word-break: break-word; }
/* Default: single column. Both grids flip to two columns only when the panel itself is wide. */
#${ROOT} .cms-grid { grid-template-columns: 1fr; }
#${ROOT} .cms-roles { grid-template-columns: 1fr; }
@container cms (inline-size >= 34rem) {
  #${ROOT} .cms-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  #${ROOT} .cms-roles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
/* Focus rings on the scoped interactive elements only; never suppress the browser default. */
#${ROOT} :is(button, select, summary, input[type="checkbox"], input[type="radio"], a):focus-visible {
  outline: 2px solid ${C.focus};
  outline-offset: 2px;
}
/* Button feedback without animation; forced-colors keeps the native system focus outline. */
@media (hover: hover) {
  #${ROOT} :is(button, summary):not(:disabled):hover { background: ${C.surfaceAlt}; }
}
#${ROOT} :is(button, summary):not(:disabled):active { background: ${C.surfaceAlt}; }
@media (forced-colors: active) {
  #${ROOT} :is(button, select, summary, input[type="checkbox"], input[type="radio"], a):focus-visible {
    outline: 3px solid CanvasText;
    outline-offset: 2px;
  }
}
/* Minimum 24px targets (WCAG 2.5.8); bump to 48px on coarse pointers (WCAG 2.5.5). */
#${ROOT} :is(button, select, summary, label:has(input[type="checkbox"]), label:has(input[type="radio"])) {
  min-block-size: 24px;
  min-inline-size: 24px;
}
@media (pointer: coarse) {
  #${ROOT} :is(button, select, summary, label:has(input[type="checkbox"]), label:has(input[type="radio"])) {
    min-block-size: 48px;
    min-inline-size: 48px;
  }
}
`

    // One consistent line-icon set: 1.8 stroke, currentColor, round caps/joins, no fills.
    const ICONS = {
      route: ['M4 6h6a4 4 0 0 1 4 4v4', ['M17 12l-3 3 3 3'], 'M3 6a1 1 0 1 0 2 0 1 1 0 1 0-2 0'],
      model: ['M12 3l7 4v10l-7 4-7-4V7z', 'M12 12l7-4', 'M12 12v9', 'M12 12L5 8'],
      session: ['M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8l-4 4z'],
      users: ['M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M3 20a5 5 0 0 1 10 0', 'M16 5a3 3 0 0 1 0 6', 'M17.5 14a5 5 0 0 1 3.5 6'],
      spark: ['M12 3l1.8 4.9L19 9.7l-4.4 3 .7 5.3L12 15.6 8.7 18l.7-5.3L5 9.7l5.2-1.8z'],
      save: ['M5 4h11l3 3v13H5z', 'M8 4v5h7V4', 'M8 20v-6h8v6'],
      reset: ['M4 10a8 8 0 1 1 2.3 6', 'M4 5v5h5'],
      check: ['M5 12.5l4.5 4.5L19 7'],
      info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 11v5', 'M12 8h.01'],
      refresh: ['M20 11a8 8 0 1 0-.7 4.5', 'M20 5v6h-6'],
      arrow: ['M5 12h13', 'M13 7l5 5-5 5'],
      copy: ['M9 9h10v10H9z', 'M5 15V5h10'],
      download: ['M12 4v10', 'M7 11l5 5 5-5', 'M5 20h14'],
    }
    function Icon({ name, size }) {
      const spec = ICONS[name] || ICONS.info
      const s = typeof size === 'number' ? size : 18
      const children = spec.map((part, index) => h('path', { key: index, d: Array.isArray(part) ? part[0] : part }))
      return h('svg', {
        viewBox: '0 0 24 24', width: s, height: s, fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true, focusable: false, style: S.icon,
      }, children)
    }

    function useSource(source) {
      const subscribe = useCallback(cb => source.subscribe(cb), [source])
      const read = useCallback(() => source.getSnapshot(), [source])
      return React.useSyncExternalStore(subscribe, read, read)
    }
    // Helper button (type=button); the primary submit is a real form submit button elsewhere.
    function Button({ children, icon, primary, disabled, onClick, title }) {
      return h('button', { type: 'button', disabled, onClick, title,
        style: Object.assign({}, S.button, primary ? S.primary : {}, disabled ? S.disabled : {}) },
        icon ? h(Icon, { name: icon, size: 16 }) : null,
        h('span', null, children))
    }
    // Note is a non-live block by default: static hints and error styling must not be announced.
    // Dynamic results use LiveNote instead; `live` here is only a rare opt-in escape hatch.
    function Note({ children, error, ok, icon, live }) {
      if (!children) return null
      const role = live === 'assertive' ? 'alert' : live === 'polite' ? 'status' : undefined
      return h('div', { role, 'aria-live': live,
        style: Object.assign({}, S.note, error ? S.noteError : ok ? S.noteOk : {}) },
        icon ? h('span', {
          style: error ? { color: C.error, display: 'inline-flex' } : ok ? { color: C.ok, display: 'inline-flex' } : { color: C.muted, display: 'inline-flex' },
        }, h(Icon, { name: icon, size: 16 })) : null,
        h('div', { style: { minWidth: 0, flex: '1 1 auto' } }, children))
    }
    // Persistent live container for dynamic results: the node stays mounted (never display:none,
    // never aria-hidden) so the live region is always in the accessibility tree and announces
    // in-place text changes. While empty it collapses to a zero-size block with no gap/margin.
    // Only "polite" success and error use this; static hints keep the inert Note above.
    function LiveNote({ error, ok, icon, text, live }) {
      const mode = live || 'polite'
      const base = { role: mode === 'assertive' ? 'alert' : 'status', 'aria-live': mode }
      const idle = { margin: 0, padding: 0, blockSize: 0, minBlockSize: 0, overflow: 'hidden', border: 0, background: 'transparent' }
      return h('div', Object.assign({}, base, { style: text ? Object.assign({}, S.note, error ? S.noteError : ok ? S.noteOk : {}) : idle }),
        text ? h(React.Fragment, null,
          icon ? h('span', {
            style: error ? { color: C.error, display: 'inline-flex' } : ok ? { color: C.ok, display: 'inline-flex' } : { color: C.muted, display: 'inline-flex' },
          }, h(Icon, { name: icon, size: 16 })) : null,
          h('div', { style: { minWidth: 0, flex: '1 1 auto' } }, text)) : null)
    }
    // Card renders a heading (h3) instead of an aria-label region, giving a clean h2→h3 outline.
    // Its body absorbs the height a stretched grid row gives the card, so an action footer can rest
    // on the bottom edge; a card in a row of its own keeps its natural height.
    function Card({ title, hint, tag, feature, icon, headingLevel, children }) {
      const hn = headingLevel || 'h3'
      return h('section', { style: Object.assign({}, S.card, feature ? S.cardFeature : {}) },
        h('div', { style: S.cardBody },
          h('div', { style: S.headRow },
            icon ? h('span', { style: { color: C.muted, display: 'inline-flex' } }, h(Icon, { name: icon, size: 18 })) : null,
            h(hn, { style: S.heading, className: 'cms-card-heading' }, title),
            tag ? h('span', { style: S.tag }, tag) : null),
          hint ? h('p', { style: S.hint, className: 'cms-hint' }, hint) : null,
          children))
    }
    function Option({ children, ...props }) {
      return h('option', Object.assign({}, props, { style: { color: C.text, background: C.surface } }), children)
    }
    // Native <select> with an explicit <label htmlFor>/id pair generated by useId.
    const Select = React.forwardRef(function Select({ label, value, disabled, onChange, children, invalid, describedBy }, selectRef) {
      const id = useId()
      return h('div', { style: S.field },
        h('label', { htmlFor: id }, label),
        h('select', { id, ref: selectRef, value, disabled, onChange: e => onChange(e.target.value), style: S.select,
          'aria-invalid': invalid ? 'true' : undefined, 'aria-describedby': describedBy },
          children))
    })
    // Native switch keeps the checkbox (enlarged, accentColor) with an explicit htmlFor label.
    function Toggle({ label, checked, disabled, onChange, describedBy }) {
      const id = useId()
      return h('div', null,
        h('input', { id, type: 'checkbox', role: 'switch', 'aria-checked': checked, checked, disabled,
          onChange: e => onChange(e.target.checked), style: Object.assign({}, S.checkbox, disabled ? S.disabled : {}),
          'aria-describedby': describedBy }),
        h('label', { htmlFor: id, style: S.switchLabel }, label))
    }
    function Details({ summary, children }) {
      return h('details', { style: S.details }, h('summary', { style: S.summary }, summary),
        h('div', { style: S.detailsBody, className: 'cms-details-body' }, children))
    }
    // Native radiogroup (fieldset/legend) for the 3-way exclusive session mode. The name is derived
    // from useId so multiple instances never share a radio group; no auto-submit on change.
    const MODES = ['inherit', 'parent', 'route']
    function ModeRadio({ t, value, disabled, onChange, describedBy }) {
      const name = useId()
      const idBase = useId()
      return h('fieldset', { style: S.radioGroup, 'aria-describedby': describedBy },
        h('legend', { style: S.radioLegend }, t('mode')),
        MODES.map(mode => {
          const inputId = idBase + '-' + mode
          const hintId = idBase + '-' + mode + '-hint'
          return h('div', { key: mode, style: S.radioRow },
            h('input', { id: inputId, type: 'radio', name, value: mode, checked: value === mode, disabled,
              onChange: () => onChange(mode), style: S.radio, 'aria-describedby': hintId }),
            h('label', { htmlFor: inputId, style: S.radioLabel },
              h('span', null, t(mode)),
              h('span', { id: hintId, style: S.radioHint, className: 'cms-radio-hint' },
                t(mode === 'route' ? 'routeHint' : mode === 'parent' ? 'parentHint' : 'inheritHint'))))
        }))
    }
    function ModelPicker({ t, catalog, value, disabled, label, onChange, invalid, describedBy, selectRef }) {
      const selected = routeKey(value)
      const known = catalog.groups.some(g => (g.models || []).some(m => routeKey({ provider: g.id, model: m.id }) === selected))
      const hasRoute = !!(value.provider || value.model)
      return h(React.Fragment, null,
        h(Select, { label, value: hasRoute ? selected : '', disabled, onChange: key => onChange(routeFromKey(key)),
          invalid, describedBy, selectRef },
          h(Option, { value: '', disabled: true }, t('choose')),
          hasRoute && !known ? h(Option, { value: selected }, value.provider + '/' + value.model + ' · ' + t('stale')) : null,
          catalog.groups.map(g => h('optgroup', { key: g.id, label: g.name || g.id }, (g.models || []).map(m =>
            h(Option, { key: routeKey({ provider: g.id, model: m.id }), value: routeKey({ provider: g.id, model: m.id }) },
              m.name + ' · ' + g.id + '/' + m.id)))),
        ),
        hasRoute && !known ? h(Note, { icon: 'info' }, t('staleHint')) : null,
        catalog.loading ? h(Note, { icon: 'info' }, t('modelsLoading')) : null,
        !catalog.loading && catalog.loaded && !catalog.groups.some(g => (g.models || []).length) ? h(Note, { icon: 'info' }, t('modelsEmpty')) : null,
      )
    }
    function containsRoute(catalog, route) {
      return catalog.groups.some(g => g.id === route.provider && (g.models || []).some(m => m.id === route.model))
    }
    // Option values use the full id; the visible label leads with the title and marks the current session.
    function SessionPicker({ t, rows, value, disabled, onChange, teams }) {
      const present = rows.some(row => row.id === value)
      return h(React.Fragment, null,
        h(Select, { label: t(teams ? 'teamsTarget' : 'target'), value: value || '', disabled: disabled || !rows.length, onChange },
          !value ? h(Option, { value: '' }, t('noSession')) : null,
          value && !present ? h(Option, { value }, value + ' · ' + t('stale')) : null,
          rows.map(row => h(Option, { key: row.id, value: row.id }, row.title + (row.current ? ' · ' + t('current') : '') + ' · ' + row.id.replace(/^session-/, '').slice(0, 8))),
        ),
        value && !present ? h(Note, { error: true, icon: 'info' }, t('missingSession')) : null,
      )
    }
    // Shows the selected id in a small, secondary collapsible area so same-titled sessions are not confused.
    function SelectedId({ t, id }) {
      const [copied, setCopied] = useState(false)
      const [copyError, setCopyError] = useState(false)
      const timer = useRef(null)
      const alive = useRef(false)
      const currentId = useRef(id)
      currentId.current = id
      useEffect(() => {
        alive.current = true
        return () => { alive.current = false; clearTimeout(timer.current) }
      }, [])
      useEffect(() => { clearTimeout(timer.current); setCopied(false); setCopyError(false) }, [id])
      if (!id) return null
      const copy = async () => {
        try {
          if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
          await navigator.clipboard.writeText(id)
          if (!alive.current || currentId.current !== id) return
          clearTimeout(timer.current)
          setCopied(true); setCopyError(false)
          timer.current = setTimeout(() => { if (alive.current) setCopied(false) }, 1500)
        } catch (_) { if (alive.current && currentId.current === id) setCopyError(true) }
      }
      return h(Details, { summary: t('selectedIdLabel') },
        h('div', { style: S.copyRow },
          h('code', { style: S.code, className: 'cms-longid' }, id),
          h('button', { type: 'button', onClick: copy, style: S.copyBtn }, copied ? t('copied') : t('copyId'))),
        h(LiveNote, { error: true, icon: 'info', text: copyError ? t('copyFailed') : '' }))
    }
    // -------------------------------------------------------------------------
    // Version & update block. It owns its own fetch lifecycle: one AbortController
    // per request, aborted on unmount, and a lock so the silent auto-check cannot
    // collide with a manual re-check or an install. It only ever POSTs a relative
    // same-origin path and never merges with the panel's own refresh snapshot.
    // -------------------------------------------------------------------------
    const UPDATE_ROUTE = '/model-delegation/update'
    const MIGRATE_COMMAND = 'dsh plugin add https://github.com/WTYJ/dsh-cross-model-subagent.git'
    const UPDATE_STATUSES = ['ready', 'up-to-date', 'ahead', 'forward', 'unknown-version', 'empty', 'error']

    // Read a response as JSON. Non-2xx with a readable JSON body is still surfaced as
    // an error message; a non-JSON or empty body falls back to a status-based message.
    // Returns { ok, data } where data is the parsed object (or null).
    async function readUpdateResponse(response, t) {
      if (!response || typeof response.status !== 'number') throw new Error(t('updateNetworkError'))
      let data = null
      try { data = await response.json() } catch (_) { data = null }
      if (!response.ok) {
        if (data && typeof data.message === 'string' && data.message) {
          const error = new Error(data.message); error.server = true; throw error
        }
        throw new Error(t('updateHttpError').replace('{status}', String(response.status)))
      }
      if (!data || typeof data !== 'object') throw new Error(t('updateBadResponse'))
      return data
    }

    function updateBadgeText(t, status) {
      switch (status) {
        case 'ready': return t('updateBadgeReady')
        case 'up-to-date': return t('updateBadgeUpToDate')
        case 'ahead':
        case 'forward': return t('updateBadgeAhead')
        case 'unknown-version': return t('updateBadgeUnknown')
        case 'empty': return t('updateBadgeEmpty')
        default: return t('updateBadgeError')
      }
    }
    function updateBadgeColor(status) {
      if (status === 'ready') return C.primary
      if (status === 'up-to-date') return C.ok
      if (status === 'error') return C.error
      if (status === 'ahead' || status === 'forward') return C.warn
      return C.muted
    }
    // Clamp long release notes to a preview width; the full text stays in the title.
    function truncateNotes(text, max) {
      if (typeof text !== 'string') return ''
      const flat = text.replace(/\s+/g, ' ').trim()
      return flat.length > max ? flat.slice(0, max - 1).trimEnd() + '…' : flat
    }
    const formatCheckedAt = (value) => {
      if (typeof value !== 'string' || !value) return ''
      const date = new Date(value)
      return isNaN(date.getTime()) ? value : date.toLocaleString()
    }
    const isLinkKind = (source) => !!source && (source.kind === 'link' || source.kind === 'path')
    const isApplySettled = (outcome) => !!outcome && outcome.phase === 'done'

    function VersionBadge({ t, status }) {
      if (!UPDATE_STATUSES.includes(status)) return null
      return h('span', {
        style: Object.assign({}, S.tag, { color: updateBadgeColor(status), borderColor: updateBadgeColor(status), fontWeight: 600 }),
      }, updateBadgeText(t, status))
    }
    function VersionValue({ t, value, placeholder }) {
      const unknown = typeof value !== 'string' || !value
      return h('code', {
        style: Object.assign({}, S.code, { flex: '0 0 auto', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }),
      }, unknown ? (placeholder || t('updateVersionUnknown')) : value)
    }
    // One read-only label/value line used for current/latest/checked-at/status rows.
    function VersionRow({ label, children }) {
      return h('div', { style: S.versionRow },
        h('span', { style: S.versionLabel }, label),
        h('span', { style: S.versionValue }, children))
    }
    // Inline (non-modal) confirmation. Focus moves to the confirm button on open;
    // Escape cancels, and the group is labelled by the question for screen readers.
    function InlineConfirm({ t, question, confirmLabel, busy, onConfirm, onCancel }) {
      const confirmRef = useRef(null)
      const questionId = useId()
      useEffect(() => {
        if (confirmRef.current && typeof confirmRef.current.focus === 'function') confirmRef.current.focus()
      }, [])
      return h('div', { role: 'group', 'aria-labelledby': questionId, style: S.confirmBox,
        onKeyDown: e => { if (e.key === 'Escape') { e.stopPropagation(); onCancel() } } },
        h('p', { id: questionId, style: S.confirmQuestion }, question),
        h('div', { style: S.row },
          h('button', { ref: confirmRef, type: 'button', disabled: busy,
            onClick: e => { e.stopPropagation(); onConfirm() },
            style: Object.assign({}, S.button, S.primary, busy ? S.disabled : {}) },
            h(Icon, { name: 'download', size: 16 }),
            h('span', null, confirmLabel)),
          h(Button, { disabled: busy, onClick: onCancel, icon: 'reset' }, t('updateCancelConfirm')),
        ),
      )
    }
    // Copyable install command (migration path). Mirrors SelectedId: async clipboard with a
    // short-lived "Copied" state, a visible manual-copy hint on failure, and a live status.
    function CopyCommand({ t, command }) {
      const [copied, setCopied] = useState(false)
      const [copyError, setCopyError] = useState(false)
      const timer = useRef(null)
      const alive = useRef(false)
      useEffect(() => {
        alive.current = true
        return () => { alive.current = false; clearTimeout(timer.current) }
      }, [])
      const copy = async () => {
        try {
          if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
          await navigator.clipboard.writeText(command)
          if (!alive.current) return
          clearTimeout(timer.current)
          setCopied(true); setCopyError(false)
          timer.current = setTimeout(() => { if (alive.current) setCopied(false) }, 1800)
        } catch (_) { if (alive.current) setCopyError(true) }
      }
      return h('div', null,
        h('div', { style: S.copyRow },
          h('code', { style: Object.assign({}, S.code, { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' }) }, command),
          h('button', { type: 'button', onClick: copy, style: S.copyBtn }, copied ? t('copied') : t('copyCommand'))),
        h(LiveNote, { error: true, icon: 'info', text: copyError ? t('copyFailedManual') : '' }))
    }

    function UpdateSection({ t }) {
      const [state, setState] = useState({ phase: 'loading', data: null, error: '' })
      const [confirming, setConfirming] = useState(false)
      const [installing, setInstalling] = useState(false)
      const [outcome, setOutcome] = useState(null)
      const lock = useRef(false)
      const alive = useRef(false)
      const controller = useRef(null)
      const mounted = useRef(false)

      const abortCurrent = () => {
        if (controller.current) { try { controller.current.abort() } catch (_) {} controller.current = null }
      }

      const runCheck = useCallback(async () => {
        if (!alive.current) return
        if (lock.current) return
        lock.current = true
        abortCurrent()
        const ac = new AbortController()
        controller.current = ac
        setState({ phase: 'loading', data: null, error: '' })
        setConfirming(false)
        try {
          const response = await fetch(UPDATE_ROUTE, {
            method: 'POST', credentials: 'same-origin', cache: 'no-store',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ action: 'check' }), signal: ac.signal,
          })
          const data = await readUpdateResponse(response, t)
          if (!alive.current || controller.current !== ac) return
          // The route may answer ok:false for a check (e.g. manager unavailable).
          if (data.ok === false) {
            setState({ phase: 'error', data: null, error: (typeof data.message === 'string' && data.message) ? data.message : t('updateCheckFailed') })
          } else {
            setState({ phase: 'ok', data, error: '' })
          }
        } catch (error) {
          if (!alive.current || controller.current !== ac) return
          if (error && error.name === 'AbortError') return
          setState({ phase: 'error', data: null, error: (error && error.message) || t('updateCheckFailed') })
        } finally {
          if (controller.current === ac) controller.current = null
          lock.current = false
        }
      }, [t])

      const runApply = useCallback(async () => {
        if (!alive.current || lock.current) return
        const data = state.data
        if (!data || !data.spec || !data.latestVersion) return
        lock.current = true
        abortCurrent()
        const ac = new AbortController()
        controller.current = ac
        setConfirming(false)
        setInstalling(true)
        setOutcome(null)
        try {
          const response = await fetch(UPDATE_ROUTE, {
            method: 'POST', credentials: 'same-origin', cache: 'no-store',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ action: 'apply', version: data.latestVersion, spec: data.spec }),
            signal: ac.signal,
          })
          const result = await readUpdateResponse(response, t)
          if (!alive.current || controller.current !== ac) return
          setOutcome({ phase: 'done', application: result.application || (result.ok ? 'applied' : 'failed'), data: result })
          setInstalling(false)
          if (controller.current === ac) controller.current = null
          lock.current = false
          // A finished install changes the on-disk version; re-run a silent check so the
          // displayed version reflects reality instead of the pre-install snapshot.
          void runCheck()
          return
        } catch (error) {
          if (!alive.current || controller.current !== ac) return
          if (error && error.name === 'AbortError') return
          setOutcome({ phase: 'done', application: 'failed', data: null, message: (error && error.message) || t('error') })
          setInstalling(false)
        } finally {
          if (controller.current === ac) controller.current = null
          lock.current = false
        }
      }, [state.data, runCheck, t])

      useEffect(() => {
        mounted.current = true
        alive.current = true
        void runCheck()
        return () => { alive.current = false; abortCurrent() }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      const data = state.data || {}
      const status = state.phase === 'ok' ? (UPDATE_STATUSES.includes(data.status) ? data.status : 'error') : null
      const busyCheck = state.phase === 'loading'
      const migrate = state.phase === 'ok' && isLinkKind(data.installedSource)
      const canInstall = state.phase === 'ok' && data.canSelfUpdate === true && data.status === 'ready' && typeof data.spec === 'string' && !!data.latestVersion
      const installDisabled = installing || busyCheck

      const outcomeText = (() => {
        if (!isApplySettled(outcome)) return ''
        const application = outcome.application
        const payload = outcome.data || {}
        const message = payload.message || outcome.message || ''
        if (application === 'applied') return t('updateApplied') + (message ? ' ' + message : '')
        if (application === 'restart-required') return t('updateRestartRequired') + (message ? ' ' + message : '')
        // failed / cancelled
        let line = t('updateFailedCancelled')
        if (message) line += ' ' + message
        if (payload.restored) line += ' ' + t('updateRestored').replace('{version}', String(payload.restored))
        return line
      })()
      const outcomeError = isApplySettled(outcome) && outcome.application !== 'applied' && outcome.application !== 'restart-required'

      return h(Card, { title: t('updateTitle'), hint: t('updateHint'), icon: 'download', headingLevel: 'h3' },
        h('div', { 'aria-busy': installing ? 'true' : undefined },
          busyCheck ? h(Note, { icon: 'refresh' }, t('updateChecking')) : null,

          // While checking for the first time we still show placeholders so the layout is stable.
          h('div', { style: S.versionBlock },
            h(VersionRow, { label: t('updateCurrentVersion') },
              h(VersionValue, { t, value: busyCheck ? null : data.currentVersion, placeholder: busyCheck ? t('updateVersionPending') : t('updateVersionUnknown') })),
            h(VersionRow, { label: t('updateLatestVersion') },
              h(VersionValue, { t, value: busyCheck ? null : data.latestVersion, placeholder: busyCheck ? t('updateVersionPending') : t('updateVersionUnknown') })),
            h(VersionRow, { label: t('updateStatus') },
              busyCheck ? h('span', { style: S.versionValue, className: 'cms-hint' }, t('updateCheckingShort'))
                : status ? h(VersionBadge, { t, status })
                : h('span', { style: S.versionValue, className: 'cms-hint' }, t('updateBadgeError'))),
            h(VersionRow, { label: t('updateCheckedAt') },
              h('span', { style: S.versionValue, className: 'cms-hint' },
                data.checkedAt ? formatCheckedAt(data.checkedAt) : t('updateCheckedNever')))),

          // Failure: persistent, readable, with an explicit retry (polite live region).
          state.phase === 'error' ? h(LiveNote, { error: true, icon: 'info', text: state.error || t('updateCheckFailed'), live: 'polite' }) : null,

          // The plugin is not installed through the manager at all: explain rather than
          // reporting a bare package name the user never chose.
          state.phase === 'ok' && data.installed === false
            ? h(Note, { icon: 'info' }, data.message || t('updateNotInstalled')) : null,

          // Ready: show the (truncated) release notes of the newer version.
          state.phase === 'ok' && status === 'ready' && data.notes
            ? h('p', { style: S.updateNotes, className: 'cms-hint', title: data.notes }, t('updateNotes') + truncateNotes(data.notes, 180))
            : null,

          // Ahead / forward: the local copy is newer than the published one, or the two
          // versions cannot be ordered. Read-only copy, no install.
          state.phase === 'ok' && (status === 'ahead' || status === 'forward')
            ? h(Note, { icon: 'info' }, t('updateAheadNote')) : null,
          state.phase === 'ok' && status === 'unknown-version'
            ? h(Note, { icon: 'info' }, t('updateUnknownNote')) : null,
          // An empty repository is not a failure: say so and keep the retry button.
          state.phase === 'ok' && status === 'empty'
            ? h(Note, { icon: 'info' }, t('updateEmptyNote')) : null,

          // Migration path: a link/path install cannot be upgraded in place. One-time note
          // plus the copyable install command; deliberately no install button.
          migrate
            ? h('div', { style: S.migrateBox },
              h(Note, { icon: 'info' }, t('updateMigrateIntro')),
              h(CopyCommand, { t, command: MIGRATE_COMMAND }),
              h('p', { style: S.hint, className: 'cms-hint' }, t('updateMigrateAfter')))
            : null,

          // The action row: install (with inline confirm), or the check/retry button.
          // One action row. It sits at the card's bottom because the card body grows, so the page
          // never ends with a half-empty card above a large gap.
          h('div', { style: S.actionRow },
            canInstall
              ? (confirming
                ? h(InlineConfirm, {
                  t,
                  question: t('updateConfirmQuestion').replace('{version}', String(data.latestVersion)),
                  confirmLabel: installing ? t('updateInstalling') : t('updateConfirmInstall'),
                  busy: installDisabled,
                  onConfirm: () => { void runApply() },
                  onCancel: () => setConfirming(false),
                })
                : h('button', { type: 'button', disabled: installDisabled, 'aria-busy': installing ? 'true' : undefined,
                  onClick: () => setConfirming(true),
                  style: Object.assign({}, S.button, S.primary, installDisabled ? S.disabled : {}) },
                  h(Icon, { name: 'download', size: 16 }),
                  h('span', null, t('updateInstallButton').replace('{version}', String(data.latestVersion)))))
              : null,
            h(Button, { disabled: installDisabled, onClick: () => { void runCheck() }, icon: 'refresh' },
              installing ? t('updateInstalling') : busyCheck ? t('updateCheckingShort') : (state.phase === 'error' ? t('updateRetry') : t('updateRecheck'))),
          ),

          // Result of an install attempt: success (polite), failure (assertive but single line).
          isApplySettled(outcome)
            ? h(LiveNote, { ok: !outcomeError, error: outcomeError, icon: outcomeError ? 'info' : 'check', text: outcomeText, live: outcomeError ? 'assertive' : 'polite' })
            : null,
        ),
      )
    }

    // Each editor freezes its revision at the first change. Refresh and refused writes never clear drafts.
    // Two message kinds: transient success (auto-clears) and persistent warning (dirty/conflict/rebase stay).
    function useEditor(scope, snap, readValue, setBusy, t) {
      const [edit, setEdit] = useState(null)
      const [saving, setSaving] = useState(false)
      const [message, setMessage] = useState('')
      const [warning, setWarning] = useState('')
      const [error, setError] = useState('')
      const lock = useRef(false)
      const timer = useRef(null)
      const alive = useRef(true)
      useEffect(() => {
        alive.current = true
        return () => { alive.current = false; clearTimeout(timer.current) }
      }, [])
      const clearTimer = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null } }
      const showSuccess = text => {
        clearTimer()
        setMessage(text)
        timer.current = setTimeout(() => { if (alive.current) setMessage('') }, 3000)
      }
      const current = readValue(snap.value || {})
      const value = edit ? edit.value : current
      const dirty = isDirty(edit)
      const change = next => {
        setEdit(previous => beginEdit(previous, current, snap.revision, next))
        setMessage(''); setWarning(''); setError('')
      }
      const discard = () => { clearTimer(); setEdit(null); setMessage(''); setWarning(''); setError('') }
      const save = async ops => {
        if (!dirty || lock.current || !edit || edit.revision === undefined) return
        lock.current = true; setSaving(true); setBusy(true); setError(''); setMessage(''); setWarning('')
        try {
          if (!acceptedWrite(await scope.mutate(ops, edit.revision))) { setError(t('refused')); return }
          setEdit(null); showSuccess(t('saved'))
        } catch (error) { setError(error && error.message || t('error')) }
        finally { lock.current = false; setSaving(false); setBusy(false) }
      }
      const conflict = dirty && edit.revision !== snap.revision
      const rebase = () => {
        setEdit(previous => previous && Object.assign({}, previous, { revision: snap.revision }))
        setError('')
        setWarning(t('rebased'))
      }
      return { value, dirty, saving, change, discard, save, conflict, rebase, message, warning, error, setError }
    }
    // Footer inside the editor's <form>; the primary Save is type=submit, helpers are type=button.
    // Only dynamic results (success/error/warning) are announced; the static dirty hint is inert.
    function EditorFooter({ editor, t, disabled }) {
      return h(React.Fragment, null,
        editor.dirty ? h(Note, { icon: 'info' }, t('dirty')) : null,
        editor.conflict ? h(Note, { icon: 'info' }, t('conflict')) : null,
        h(LiveNote, { error: true, icon: 'info', text: editor.error }),
        h(LiveNote, { ok: true, icon: 'check', text: editor.message }),
        h(LiveNote, { icon: 'info', text: editor.warning }),
        h('div', { style: S.footer },
          h('button', { type: 'submit', disabled: disabled || editor.saving || !editor.dirty,
            style: Object.assign({}, S.button, S.primary, disabled || editor.saving || !editor.dirty ? S.disabled : {}) },
            h(Icon, { name: 'save', size: 16 }), h('span', null, t(editor.saving ? 'saving' : 'save'))),
          h(Button, { disabled: editor.saving || !editor.dirty, onClick: editor.discard, icon: 'reset' }, t('discard')),
        ),
        editor.conflict ? h(Button, { disabled: disabled || editor.saving, onClick: editor.rebase, icon: 'reset' }, t('rebase')) : null,
      )
    }
    function RolesOverview({ t }) {
      return h('div', { style: S.roles, className: 'cms-roles' },
        h('div', { style: S.roleBox },
          h('span', { style: S.roleIcon }, h(Icon, { name: 'route', size: 20 })),
          h('div', { style: { minWidth: 0 } },
            h('p', { style: S.roleName }, t('roleMain')),
            h('p', { style: S.roleHint, className: 'cms-role-hint' }, t('roleMainHint')))),
        h('div', { style: S.roleBox },
          h('span', { style: S.roleIcon }, h(Icon, { name: 'spark', size: 20 })),
          h('div', { style: { minWidth: 0 } },
            h('p', { style: S.roleName }, t('roleWorker')),
            h('p', { style: S.roleHint, className: 'cms-role-hint' }, t('roleWorkerHint')))),
      )
    }
    function GlobalSection({ ctx, scope, snap, t, catalog, blocked, setBusy }) {
      const editor = useEditor(scope, snap, defaultValue, setBusy, t)
      const value = editor.value
      const [invalid, setInvalid] = useState(false)
      const modelRef = useRef(null)
      const modelHelpId = useId()
      const submit = () => {
        if (blocked) return
        if (value.routingEnabled && !containsRoute(catalog, { provider: value.defaultProvider, model: value.defaultModel })) {
          editor.setError(t('needModel'))
          setInvalid(true)
          if (modelRef.current && typeof modelRef.current.focus === 'function') modelRef.current.focus()
          return
        }
        void editor.save(Object.keys(value).map(field => ({ op: 'set', path: [field], value: value[field] })))
      }
      const changeRoute = route => { setInvalid(false); editor.change(Object.assign({}, value, { defaultProvider: route.provider, defaultModel: route.model })) }
      return h(Card, { title: t('globalTitle'), hint: t('globalHint'), icon: 'model', headingLevel: 'h3' },
        h('form', { onSubmit: e => { e.preventDefault(); submit() }, noValidate: true },
          h(Toggle, { label: t('enable'), checked: value.routingEnabled, disabled: blocked,
            onChange: enabled => { setInvalid(false); editor.change(Object.assign({}, value, { routingEnabled: enabled })) } }),
          value.routingEnabled
            ? h(ModelPicker, { t, catalog, label: t('model'), value: { provider: value.defaultProvider, model: value.defaultModel }, disabled: blocked,
              onChange: changeRoute, invalid, describedBy: modelHelpId, selectRef: modelRef })
            : h('p', { style: S.hint, className: 'cms-hint' }, t('off')),
          h('span', { id: modelHelpId, style: invalid ? { fontSize: 12, color: C.error, display: 'block' } : { display: 'none' } }, invalid ? t('needModel') : ''),
          h(EditorFooter, { editor, t, disabled: blocked }),
        ),
      )
    }
    function SessionSection({ scope, snap, t, catalog, rows, sessionsLoading, blocked, setBusy }) {
      const [chosen, setChosen] = useState('')
      const activeId = chosen || (rows.find(row => row.current) || rows[0] || {}).id || ''
      const editor = useEditor(scope, snap, value => sessionValue(value, activeId), setBusy, t)
      const value = editor.value
      const present = rows.some(row => row.id === activeId)
      const [invalid, setInvalid] = useState(false)
      const modelRef = useRef(null)
      const modeHelpId = useId()
      const modelErrId = useId()
      const change = next => { setChosen(activeId); setInvalid(false); editor.change(next) }
      const submit = () => {
        if (blocked || !present) return
        if (value.mode === 'route' && !containsRoute(catalog, value)) {
          editor.setError(t('needModel'))
          setInvalid(true)
          if (modelRef.current && typeof modelRef.current.focus === 'function') modelRef.current.focus()
          return
        }
        void editor.save([{ op: 'set', path: ['sessionDefaults'], value: replaceSession((snap.value || {}).sessionDefaults, activeId, value) }])
      }
      const saved = sessionValue(snap.value || {}, activeId)
      const global = defaultValue(snap.value || {})
      const behavior = saved.mode === 'route' ? saved.provider + '/' + saved.model
        : saved.mode === 'parent' || !global.routingEnabled ? t('parent') : global.defaultProvider + '/' + global.defaultModel
      return h(Card, { title: t('sessionTitle'), hint: t('sessionHint'), tag: t('optional'), feature: true, icon: 'session', headingLevel: 'h3' },
        sessionsLoading ? h(Note, { icon: 'info' }, t('sessionLoading')) : null,
        !rows.length && !activeId ? h(Note, { icon: 'info' }, t('noSession')) : null,
        h(SessionPicker, { t, rows, value: activeId, disabled: blocked || editor.dirty, onChange: id => { setChosen(id); editor.discard(); setInvalid(false) } }),
        h(SelectedId, { t, id: activeId }),
        editor.dirty ? h('p', { style: S.hint, className: 'cms-hint' }, t('switchProtected')) : null,
        activeId ? h('form', { onSubmit: e => { e.preventDefault(); submit() }, noValidate: true },
          h('p', { style: S.effective, className: 'cms-effective' }, t('effective') + behavior),
          h(ModeRadio, { t, value: value.mode, disabled: blocked || !present, onChange: mode => change({ mode, provider: mode === 'route' ? value.provider : '', model: mode === 'route' ? value.model : '' }), describedBy: modeHelpId }),
          h('span', { id: modeHelpId, style: { display: 'none' } }, t('modeHelp')),
          value.mode === 'route' ? h(ModelPicker, { t, catalog, label: t('sessionModel'), value, disabled: blocked || !present,
            onChange: route => { setInvalid(false); change(Object.assign({}, route, { mode: 'route' })) }, invalid, describedBy: modelErrId, selectRef: modelRef }) : null,
          h('span', { id: modelErrId, style: invalid ? { fontSize: 12, color: C.error, display: 'block' } : { display: 'none' } }, invalid ? t('needModel') : ''),
          h(EditorFooter, { editor, t, disabled: blocked || !present }),
        ) : null,
      )
    }
    function ForceSection({ scope, snap, t, blocked, setBusy }) {
      const editor = useEditor(scope, snap, value => value.forceAgentTeams === true, setBusy, t)
      return h(Card, { title: t('forceTitle'), hint: t('forceHint'), icon: 'users', headingLevel: 'h3' },
        h('form', { onSubmit: e => { e.preventDefault(); if (blocked) return; void editor.save([{ op: 'set', path: ['forceAgentTeams'], value: editor.value }]) } },
          h(Toggle, { label: t('forceLabel'), checked: editor.value, disabled: blocked, onChange: editor.change }),
          h(EditorFooter, { editor, t, disabled: blocked }),
        ),
      )
    }
    // Team operation card is NOT a form: it calls an RPC action and has no navigation target.
    function TeamsSection({ ctx, t, rows, blocked, setBusy }) {
      const [chosen, setChosen] = useState('')
      const [busy, setLocalBusy] = useState(false)
      const [result, setResult] = useState(null)
      const lock = useRef(false)
      const activeId = chosen || (rows.find(row => row.current) || rows[0] || {}).id || ''
      const present = rows.some(row => row.id === activeId)
      const run = async enabled => {
        if (!present || lock.current) return
        const id = activeId
        setChosen(id)
        lock.current = true; setLocalBusy(true); setBusy(true); setResult(null)
        try {
          const response = await ctx.remote.agentTeams.setEnabled(id, enabled)
          if (!response || !response.ok) throw new Error(response && response.error && response.error.message || t('error'))
          setResult({ id, text: t(enabled ? 'teamsEnabled' : 'teamsDisabled') })
        } catch (error) { setResult({ id, error: true, text: error && error.message || t('error') }) }
        finally { lock.current = false; setLocalBusy(false); setBusy(false) }
      }
      return h(Card, { title: t('teamsExistingTitle'), hint: t('teamsHint'), icon: 'users', headingLevel: 'h3' },
        h(SessionPicker, { t, teams: true, rows, value: activeId, disabled: blocked || busy, onChange: id => { setChosen(id); setResult(null) } }),
        h(SelectedId, { t, id: activeId }),
        h('p', { style: S.hint, className: 'cms-hint' }, t('teamsUnknown')),
        h('div', { style: S.row },
          h(Button, { primary: true, disabled: blocked || busy || !present, onClick: () => { void run(true) }, icon: 'check' }, t('teamsEnable')),
          h(Button, { disabled: blocked || busy || !present, onClick: () => { void run(false) }, icon: 'reset' }, t('teamsDisable'))),
        busy ? h(Note, { icon: 'info' }, t('working')) : null,
        result && result.id === activeId ? h(LiveNote, { error: result.error, ok: !result.error, icon: result.error ? 'info' : 'check', text: result.text + ' (' + result.id + ')', live: result.error ? 'assertive' : 'polite' }) : null,
      )
    }
    function Panel({ ctx, t, useSessions }) {
      const scope = useMemo(() => ctx.configForms.get(CONFIG), [ctx])
      const mirror = useMemo(() => ctx.configForms.describe(), [ctx])
      const snap = useSource(scope)
      const mirrorSnap = useSource(mirror)
      const sessions = useSessions(state => state)
      const hookRows = sessionRows(sessions)
      const [freshIds, setFreshIds] = useState(null)
      const [catalog, setCatalog] = useState({ groups: [], loading: true, loaded: false })
      const [refreshing, setRefreshing] = useState(false)
      const [refreshMessage, setRefreshMessage] = useState('')
      const [refreshError, setRefreshError] = useState('')
      const [availability, setAvailability] = useState({ present: null, writable: null, mirrorView: null })
      const [busyCount, setBusyCount] = useState(0)
      const busy = useCallback(active => setBusyCount(n => Math.max(0, n + (active ? 1 : -1))), [])
      const refreshLock = useRef(false)
      const alive = useRef(true)
      const refreshTimer = useRef(null)
      const gridMainId = useId()
      const clearRefreshTimer = () => { if (refreshTimer.current) { clearTimeout(refreshTimer.current); refreshTimer.current = null } }
      useEffect(() => () => { alive.current = false; clearRefreshTimer() }, [])
      // The official list refresh returns void even after a failed RPC. Verify the real
      // list response separately so a swallowed failure cannot produce a success notice.
      // announce=false for the initial load; announce=true only for a manual refresh, and a
      // success notice appears only when every source succeeded, then auto-clears after ~3s.
      const refresh = useCallback(async (announce) => {
        if (refreshLock.current) return
        refreshLock.current = true
        clearRefreshTimer()
        setRefreshing(true); setRefreshMessage(''); setRefreshError('')
        setCatalog(previous => Object.assign({}, previous, { loading: true }))
        const results = await Promise.allSettled([
          ctx.sessions.refresh(), ctx.remote.session.modelCatalog(), ctx.remote.settings.describe(), ctx.remote.session.list({}), mirror.ensure(),
        ])
        if (!alive.current) { refreshLock.current = false; return }
        const errors = []
        const response = (index, label) => {
          const settled = results[index]
          if (settled.status === 'rejected') { errors.push(label + ': ' + (settled.reason && settled.reason.message || String(settled.reason))); return null }
          const result = settled.value
          if (!result || !result.ok) { errors.push(label + ': ' + (result && result.error && result.error.message || t('error'))); return null }
          return result.value
        }
        if (results[0].status === 'rejected') errors.push(t('sessions') + ': ' + String(results[0].reason))
        const models = response(1, t('models'))
        if (models) {
          setCatalog({ groups: models.groups || [], loading: false, loaded: true })
          if ((models.failures || []).length) errors.push(t('partial') + models.failures.map(f => f.name + ': ' + f.message).join('; '))
        } else setCatalog(previous => Object.assign({}, previous, { loading: false }))
        const config = response(2, t('config'))
        if (config) {
          const view = (config.namespaces || []).find(view => view.ns === CONFIG)
          // acceptView is the documented public fold. It does not fold document-level
          // writability or remove namespaces, so this panel also tracks both explicitly.
          if (view) {
            const currentRevision = scope.getSnapshot().revision
            if (currentRevision === undefined || view.revision >= currentRevision) mirror.acceptView(view)
          } else errors.push(t('unavailable'))
          const heldMirror = mirror.getSnapshot()
          if (!heldMirror.view) errors.push(heldMirror.error || t('configLoading'))
          setAvailability({ present: !!view && !!heldMirror.view, writable: config.writable === true, mirrorView: heldMirror.view, mirrorSnapshot: heldMirror })
        }
        const list = response(3, t('sessions'))
        if (list) setFreshIds({ ids: (list.items || []).filter(row => row.origin !== 'subagent').map(row => row.sessionId), baseline: ctx.sessions.list.getSnapshot() })
        setRefreshError(errors.length ? t('refreshFailed') + errors.join(' · ') : '')
        if (!errors.length && announce) {
          setRefreshMessage(t('refreshed'))
          refreshTimer.current = setTimeout(() => { if (alive.current) setRefreshMessage('') }, 3000)
        } else setRefreshMessage('')
        setRefreshing(false); refreshLock.current = false
      }, [ctx, mirror, scope, t])
      useEffect(() => {
        alive.current = true
        void refresh(false)
        return () => { alive.current = false; clearRefreshTimer() }
      }, [refresh])
      // Use the official Slot hook for labels and live updates. Preserve ids from a
      // successful explicit read until the shared list catches up; never invent ids.
      const rows = freshIds === null || sessions !== freshIds.baseline ? hookRows : freshIds.ids
        .map(id => hookRows.find(row => row.id === id) || { id, title: id, current: false })
      const localFresh = mirrorSnap.view === availability.mirrorView
      const missing = (localFresh && availability.present === false) || snap.status === 'unavailable'
      const writable = localFresh && availability.writable !== null ? availability.writable : snap.writable
      const blocked = refreshing || busyCount > 0 || snap.status !== 'ready' || missing || !writable
      // Re-stamp the scope class/panel container root and mount one scoped <style> that unmounts
      // with the panel. No body/root/global selectors are introduced.
      return h('div', { id: ROOT, className: ROOT, style: S.wrap, 'aria-busy': refreshing },
        h('style', null, PANEL_CSS),
        h('div', { style: S.inner, className: 'cms-inner' },
          h('header', { style: S.header },
            h('div', { style: S.headerText },
              h('h1', { style: S.title, className: 'cms-title' }, t('panelTitle')),
              h('p', { style: S.sub, className: 'cms-sub' }, t('intro'))),
            h('button', { type: 'button', title: t('refresh'), 'aria-label': t('refresh'),
              disabled: refreshing || busyCount > 0, onClick: () => { void refresh(true) },
              style: Object.assign({}, S.iconBtn, refreshing || busyCount > 0 ? S.disabled : {}) },
              h(Icon, { name: 'refresh', size: 16 }),
              h('span', null, t(refreshing ? 'refreshing' : 'refreshAction')))),
          h('h2', { style: S.groupTitle }, t('rolesTitle')),
          h(RolesOverview, { t }),
          h(LiveNote, { ok: true, icon: 'check', text: refreshMessage }),
          h(LiveNote, { error: true, icon: 'info', text: refreshError || (availability.present && availability.mirrorSnapshot === mirrorSnap ? '' : mirrorSnap.error) }),
          h(Note, { icon: 'info' }, snap.status === 'loading' ? t('configLoading') : missing ? t('unavailable') : !writable ? t('readOnly') : ''),
          snap.value && snap.value.sessionRoutesJson && snap.value.sessionRoutesJson !== '{}' ? h(Note, { icon: 'info' }, t('legacy')) : null,
          h(Details, { summary: t('details') }, t('scopeHint')),
          h('div', { style: Object.assign({}, S.grid, { marginTop: 16 }), className: 'cms-grid', id: gridMainId },
            h('section', { style: S.group },
              h('h2', { style: S.groupTitle }, t('colSession')),
              h('div', { style: S.cards },
                h(SessionSection, { scope, snap, t, catalog, rows, sessionsLoading: !sessions || sessions.phase === 'pending', blocked, setBusy: busy }))),
            h('section', { style: S.group },
              h('h2', { style: S.groupTitle }, t('colGlobal')),
              h('div', { style: S.cards },
                h(GlobalSection, { ctx, scope, snap, t, catalog, blocked, setBusy: busy })))),
          h('section', { style: Object.assign({}, S.group, { marginTop: 16 }) },
            h('h2', { style: S.groupTitle }, t('teamsTitle')),
            // `cms-grid` makes this row follow the same container-query columns as the model row;
            // the columns stretch so two cards of different heights end on one line.
            h('div', { style: S.grid, className: 'cms-grid' },
              h(ForceSection, { scope, snap, t, blocked, setBusy: busy }),
              h(TeamsSection, { ctx, t, rows, blocked: refreshing || busyCount > 0, setBusy: busy }))),
          // Updates are independent of the configuration forms: they stay usable while a
          // draft is dirty, and the panel's own refresh never drives this block. A lone card
          // keeps its natural height, so it must not inherit the stretched column wrapper.
          h('section', { style: Object.assign({}, S.group, { marginTop: 16 }) },
            h('h2', { style: S.groupTitle }, t('updateTitle')),
            h('div', { style: S.sectionStack }, h(UpdateSection, { t }))),
        ))
    }
    function PanelIcon(props) {
      const size = typeof props.size === 'number' ? props.size : 20
      return h('svg', { viewBox: '0 0 24 24', width: size, height: size, fill: 'none', stroke: 'currentColor',
        strokeWidth: 1.75, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false },
        h('path', { d: 'M4 6h6a4 4 0 0 1 4 4v4' }),
        h('path', { d: 'M17 12l-3 3 3 3' }),
        h('circle', { cx: 3.5, cy: 6, r: 1.2, fill: 'currentColor', stroke: 'none' }))
    }
    return {
      inject: ['slots', 'locale', 'configForms', 'sessions', 'remote', 'remote.session', 'remote.settings', 'remote.agentTeams'],
      apply(ctx) {
        const ID = 'cross_model_subagent_settings'
        const t = ctx.locale.bind(NS)
        ctx.effect(() => ctx.locale.register(NS, dict), 'cross-model-subagent: dictionaries')
        function PanelBound(props) { return h(Panel, { ctx, t, useSessions: props.useSessions }) }
        ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: ID, locale: NS }, PanelBound)), 'cross-model-subagent: main panel')
        ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: ID, order: 5, label: () => t('panelIcon'), locale: NS }, PanelIcon)), 'cross-model-subagent: sidebar entry')
      },
    }
  },
})
