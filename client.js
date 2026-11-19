window.__ModuleLoader__.load({
  id: 'dsh-cross-model-subagent',
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
    function routeLabel(route) {
      return route?.provider && route?.model ? route.provider + ' / ' + route.model : ''
    }
    function teamMemberLookupIds(ids, known, refreshKey, lastRefresh) {
      return ids.filter(id => !known.has(id) || (refreshKey > 0 && lastRefresh.get(id) !== refreshKey))
    }
    function teamMemberBatch(ids, data, known) {
      if (!data?.ok) return { confirmed: [], waiting: [], failed: true }
      const requested = new Set(ids)
      const confirmed = (data.members ?? []).filter(member => requested.has(member.id) && routeLabel(member.route))
      for (const member of confirmed) requested.delete(member.id)
      return { confirmed, waiting: [...requested].filter(id => !known.has(id)), failed: false }
    }
    function observeTeam(previous, enabled, catalog) {
      if (typeof enabled !== 'boolean' || !Array.isArray(catalog)) return previous
      if (!previous || !enabled) return { seen: new Set(catalog.map(row => row.id)), announced: false, members: [] }
      const added = catalog.filter(row => !previous.seen.has(row.id))
      if (added.length === 0) return previous
      return { seen: new Set([...previous.seen, ...added.map(row => row.id)]), announced: true,
        members: [...previous.members, ...added] }
    }
    function teamNotifications() {
      const observers = new Map()
      const listeners = new Set()
      let current = null
      function publish(value) {
        current = value
        for (const notify of listeners) notify()
      }
      return {
        getSnapshot: () => current,
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
        dismiss(id) { if (current?.sessionId === id) publish(null) },
        unobserve(id) { observers.delete(id); this.dismiss(id) },
        observe(sessionId, enabled, catalog) {
          const previous = observers.get(sessionId)
          const next = observeTeam(previous, enabled, catalog)
          if (!next || next === previous) return
          observers.set(sessionId, next)
          if (!enabled) this.dismiss(sessionId)
          else if (next.announced) {
            publish({ sessionId, members: next.members })
          }
        },
      }
    }
    // END PURE HELPERS

    const dict = {
      zh: {
        panelTitle: '模型分工', panelIcon: '模型分工',
        intro: '为普通子代理设置执行模型，并管理会话的团队协作。',
        workerSettings: '执行模型',
        globalTitle: '全局默认', globalHint: '用于未单独设置执行模型的会话。',
        enable: '指定全局执行模型', off: '关闭时沿用父级模型。', model: '全局执行模型',
        sessionTitle: '会话覆盖', sessionHint: '对所选会话的后续委派生效，优先于全局默认。',
        target: '目标会话', mode: '会话模型模式', inherit: '继承全局默认', parent: '沿用父级模型', route: '指定一个模型',
        sessionModel: '本会话的执行模型', inheritHint: '清除覆盖后，这个会话将使用全局默认；全局关闭时沿用父模型。',
        parentHint: '这个会话始终沿用父级模型，即使全局指定了默认模型。', routeHint: '这个会话使用下面的模型，即使全局默认关闭。',
        modeHelp: '三选一：继承全局默认、沿用父级模型，或指定一个模型。本组任一选择都不会自动提交。',
        teamNoticeMain: '主代理', teamNoticeTitle: '团队协作已开始', teamNoticeSettings: '打开设置', teamNoticeClose: '临时关闭提示', teamNoticeMute: '不再弹出', teamNoticeToggle: '团队协作开始时弹出模型提示（取消勾选即永久关闭）',
        teamNoticePreference: '团队协作弹窗', teamNoticePreferenceHint: '关闭后可在这里重新开启。', teamNoticeList: '团队成员模型',
        teamNoticeWaiting: '等待模型确认…', teamNoticeUnavailable: '未能读取模型', teamNoticeActions: '可前往模型分工设置。', teamNoticeNavError: '暂时无法打开模型分工设置。',
        teamNoticeRefresh: '刷新模型', teamNoticeRefreshing: '正在刷新模型…', teamNoticeRefreshFailed: '部分模型信息暂时无法读取，请点击刷新重试。',
        runtimeNext: '下次普通委派', runtimeSession: '会话覆盖', runtimeGlobal: '全局默认', runtimeParent: '沿用父级模型',
        runtimeClosed: '打开该会话后检查是否生效。', runtimeUnsupported: '该会话的预设使用原生委派行为。',
        runtimeNoTool: '该会话没有普通子代理工具。', runtimeMountFailed: '模型覆盖加载失败，委派由原生工具处理。',
        runtimeInvalid: '已保存的模型配置不完整，请检查设置。', runtimeUnavailable: '暂时无法读取生效状态。', runtimeLoading: '正在核对生效状态…',
        effective: '已保存：', noSession: '暂无可选会话。请先创建或打开会话，再刷新。', current: '当前会话',
        sessionLoading: '正在加载会话…', missingSession: '所选会话已不在可用列表中。草稿保留，请撤销后重新选择。',
        selectedIdLabel: '所选会话详情', copyId: '复制', copied: '已复制', copyFailed: '复制失败，可直接选取会话 ID 文本。',
        teamsTitle: '团队协作', teamsOfficial: '已有会话请在对应根会话的模型／推理菜单中操作。官方开关会显示当前状态，并在需要时确认停用。',
        forceTitle: '新会话默认', forceHint: '应用于之后新建的根会话。', forceLabel: '自动启用团队协作',
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
        legacy: '检测到旧版会话授权数据。请在「会话覆盖」中为相应会话选择执行模型。',
        updateTitle: '版本与更新', updateHint: '检查并安装此插件的 GitHub 版本。',
        updateCurrentVersion: '当前版本', updateLatestVersion: '最新版本', updateStatus: '状态', updateCheckedAt: '上次检查',
        updateVersionUnknown: '未知', updateVersionPending: '检查中',
        updateCheckingShort: '正在检查…', updateCheckFailed: '无法检查更新。',
        updateCheckedNever: '尚未检查',
        updateBadgeReady: '可发现新版本', updateBadgeUpToDate: '已是最新', updateBadgeAhead: '当前本地版本更新',
        updateEmptyNote: '仓库还没有任何提交，因此暂时无法比较版本；推送第一个版本后再检查即可。',
        updateBadgeUnknown: '无法比较版本', updateBadgeEmpty: '仓库尚无提交', updateBadgeError: '检查失败',
        updateNotes: '更新说明：', updateReleaseLink: '查看 GitHub 更新日志',
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
        intro: 'Set the worker model for ordinary subagents and manage session teamwork.',
        workerSettings: 'Worker model',
        globalTitle: 'Global default', globalHint: 'Applies to sessions without a worker model override.',
        enable: 'Use a global worker model', off: 'When off, subagents inherit the parent model.', model: 'Global worker model',
        sessionTitle: 'Session override', sessionHint: 'Applies to future delegations in the selected session and takes priority over the global default.',
        target: 'Target session', mode: 'Session model mode', inherit: 'Inherit global default', parent: 'Use parent model', route: 'Specify one model',
        sessionModel: 'Subagent model for this session', inheritHint: 'Clearing the override restores the global default, or the parent model when the global default is off.',
        parentHint: 'This session uses the parent model even when a global default is specified.', routeHint: 'This session uses the model below even when the global default is off.',
        modeHelp: 'Choose one of three: inherit the global default, use the parent model, or specify one model. Selecting any option never auto-submits.',
        teamNoticeMain: 'Main agent', teamNoticeTitle: 'Agent teamwork started', teamNoticeSettings: 'Open settings', teamNoticeClose: 'Dismiss for now', teamNoticeMute: 'Don’t show again', teamNoticeToggle: 'Show model notice when teamwork starts (uncheck to turn off)',
        teamNoticePreference: 'Team notifications', teamNoticePreferenceHint: 'You can turn them back on here at any time.', teamNoticeList: 'Team member models',
        teamNoticeWaiting: 'Waiting for model information…', teamNoticeUnavailable: 'Model unavailable', teamNoticeActions: 'Model delegation settings are available.', teamNoticeNavError: 'Could not open model delegation settings.',
        teamNoticeRefresh: 'Refresh models', teamNoticeRefreshing: 'Refreshing models…', teamNoticeRefreshFailed: 'Some model information could not be loaded. Select Refresh models to try again.',
        runtimeNext: 'Next ordinary delegation', runtimeSession: 'Session override', runtimeGlobal: 'Global default', runtimeParent: 'Parent model',
        runtimeClosed: 'Open the session to check whether the override is active.', runtimeUnsupported: 'This session’s preset uses native delegation behavior.',
        runtimeNoTool: 'This session has no ordinary subagent tool.', runtimeMountFailed: 'The model override failed to load. The native tool handles delegation.',
        runtimeInvalid: 'The saved model configuration is incomplete. Check the settings.', runtimeUnavailable: 'The active status is unavailable.', runtimeLoading: 'Checking active status…',
        effective: 'Saved: ', noSession: 'No sessions available. Create or open a session, then refresh.', current: 'Current session',
        sessionLoading: 'Loading sessions…', missingSession: 'The selected session is no longer available. The draft is retained; discard it to select another session.',
        selectedIdLabel: 'Selected session details', copyId: 'Copy', copied: 'Copied', copyFailed: 'Copy failed. Select the session ID text to copy it manually.',
        teamsTitle: 'Agent Teams', teamsOfficial: 'For an existing session, use its root conversation’s model and reasoning menu. The built-in switch shows the current state and confirms disabling when needed.',
        forceTitle: 'New sessions', forceHint: 'Applies to newly created root sessions.', forceLabel: 'Enable teamwork automatically',
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
        updateTitle: 'Version & updates', updateHint: 'Check for and install this plugin’s GitHub releases.',
        updateCurrentVersion: 'Current version', updateLatestVersion: 'Latest version', updateStatus: 'Status', updateCheckedAt: 'Last checked',
        updateVersionUnknown: 'Unknown', updateVersionPending: 'Checking',
        updateCheckingShort: 'Checking…', updateCheckFailed: 'Could not check for updates.',
        updateCheckedNever: 'Not checked yet',
        updateBadgeReady: 'New version available', updateBadgeUpToDate: 'Up to date', updateBadgeAhead: 'Local version is newer',
        updateEmptyNote: 'The repository has no commits yet, so there is no version to compare against. Check again after the first release is pushed.',
        updateBadgeUnknown: 'Cannot compare versions', updateBadgeEmpty: 'No commits published yet', updateBadgeError: 'Check failed',
        updateNotes: 'Release notes: ', updateReleaseLink: 'View GitHub release notes',
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
      border: 'var(--dsw-alias-border-l2)', borderSoft: 'var(--dsw-alias-border-l1)',
      surface: 'var(--dsw-alias-bg-layer-1)', surfaceAlt: 'var(--dsw-alias-bg-layer-2)',
      fill: 'var(--dsw-alias-bg-layer-2)', primary: 'var(--dsw-alias-brand-primary)',
      onPrimary: 'var(--dsw-alias-label-primary-inverted)', error: 'var(--dsw-alias-state-error-primary)',
      ok: 'var(--dsw-alias-state-success-primary)',
      warn: 'var(--dsw-alias-state-warn-primary)', focus: 'var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary))',
    }
    // Body and controls share one size. Weight distinguishes row headings and labels;
    // secondary text stays within one step of body text.
    const type = { title: '1.375rem', section: '1.125rem', body: '1rem', detail: '0.9375rem' }
    // Keep text sizes and spacing consistent across the forms and the update summary.
    const S = {
      wrap: { flex: '1 1 auto', minHeight: 0, height: '100%', width: '100%', overflowY: 'auto', scrollbarGutter: 'stable',
        overscrollBehavior: 'contain', boxSizing: 'border-box', color: C.text, fontSize: type.body, lineHeight: 1.5 },
      inner: { maxInlineSize: '62rem', marginInline: 'auto', padding: '1.5rem clamp(1rem, 4cqi, 2rem) 2.5rem',
        paddingBlockStart: 'calc(1.5rem + var(--dsh-frame-leading-clearance, 0px))' },
      header: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' },
      headerText: { flex: '1 1 18rem', minWidth: 0 },
      title: { fontSize: type.title, fontWeight: 650, margin: '0 0 0.375rem', lineHeight: 1.25 },
      sub: { color: C.muted, margin: 0, maxInlineSize: '60ch' },
      sectionHeading: { fontSize: type.section, fontWeight: 650, lineHeight: 1.35, margin: 0 },
      groupTitle: { fontSize: type.section, fontWeight: 650, lineHeight: 1.35, margin: '0 0 0.625rem' },
      card: { border: '1px solid ' + C.borderSoft, borderRadius: '0.75rem', background: C.surface },
      heading: { fontSize: type.body, fontWeight: 650, lineHeight: 1.4, margin: 0 },
      tag: { display: 'inline-block', fontSize: type.detail, fontWeight: 600, padding: '0.125rem 0.5rem', borderRadius: '0.375rem', background: C.fill },
      hint: { color: C.muted, fontSize: type.detail, margin: 0 },
      teamNoticeTitle: { font: 'inherit', fontWeight: 650, fontSize: type.body, color: C.ok, margin: 0 },
      link: { color: C.text, textDecoration: 'underline', textUnderlineOffset: '0.15em' },
      row: { display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' },
      field: { display: 'grid', gap: '0.375rem', minWidth: 0, fontWeight: 550 },
      select: { width: '100%', minWidth: 0, boxSizing: 'border-box', borderRadius: '0.5rem', border: '1px solid ' + C.border,
        minBlockSize: '2.25rem', padding: '0.5rem 0.75rem', color: C.text, background: C.fill, font: 'inherit', fontWeight: 400 },
      button: { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', borderRadius: '0.5rem',
        padding: '0.4375rem 0.75rem', border: '1px solid ' + C.border, background: C.fill, color: C.text,
        font: 'inherit', fontWeight: 550, cursor: 'pointer', maxWidth: '100%', minBlockSize: '2.25rem' },
      primary: { background: C.primary, color: C.onPrimary, borderColor: C.primary },
      disabled: { opacity: 0.55, cursor: 'not-allowed' },
      note: { display: 'flex', alignItems: 'flex-start', gap: '0.5rem', padding: '0.5rem 0.75rem', fontSize: type.detail,
        background: C.fill, borderRadius: '0.5rem' },
      noteError: { borderInlineStart: '3px solid ' + C.error },
      noteOk: { borderInlineStart: '3px solid ' + C.ok },
      choice: { alignItems: 'start', cursor: 'pointer', display: 'grid', gridTemplateColumns: '1.125rem minmax(0, 1fr)',
        columnGap: '0.625rem', paddingBlock: '0.375rem' },
      input: { inlineSize: '1.125rem', blockSize: '1.125rem', accentColor: C.primary, margin: '0.125rem 0 0' },
      radioGroup: { border: 0, padding: 0, margin: 0, minInlineSize: 0 },
      radioLegend: { fontWeight: 650, padding: 0, marginBlockEnd: '0.25rem' },
      details: { color: C.muted, fontSize: type.detail },
      summary: { cursor: 'pointer', inlineSize: 'fit-content', maxInlineSize: '100%', paddingBlock: '0.125rem' },
      detailsBody: { marginBlockStart: '0.375rem', maxInlineSize: '65ch' },
      detailsTitle: { margin: '0 0 0.375rem', color: C.text },
      copyRow: { display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' },
      code: { fontFamily: 'ui-monospace, Consolas, monospace', fontSize: type.detail, color: C.text,
        background: C.fill, borderRadius: '0.375rem', padding: '0.25rem 0.5rem', overflowWrap: 'anywhere' },
      effective: { fontSize: type.detail, color: C.muted, margin: 0 },
      icon: { flex: '0 0 auto' },
      versionBlock: { display: 'grid', gap: '0.75rem 1rem', margin: 0 },
      versionLabel: { fontSize: type.detail, color: C.muted },
      versionValue: { minWidth: 0, margin: '0.25rem 0 0', fontVariantNumeric: 'tabular-nums' },
      updateNotes: { fontSize: type.detail, color: C.muted, margin: 0 },
      confirmBox: { flex: '1 1 16rem', border: '1px solid ' + C.border, borderRadius: '0.5rem', padding: '0.75rem', background: C.surfaceAlt },
      confirmQuestion: { margin: '0 0 0.5rem' },
    }

    const PANEL_CSS = `
#${ROOT} {
  container: cms / inline-size;
  min-inline-size: 0;
  overflow-wrap: anywhere;
}
#${ROOT} .cms-inner { display: grid; gap: 1.5rem; box-sizing: border-box; }
#${ROOT} .cms-stack { display: grid; gap: 0.75rem; min-inline-size: 0; }
#${ROOT} .cms-stack > .cms-idle,
#${ROOT} .cms-feedback:not(:has(> :not(.cms-idle))) { position: absolute; }
#${ROOT} .cms-card { padding: clamp(0.875rem, 3cqi, 1.25rem); }
#${ROOT} .cms-card + .cms-card { border-block-start: 1px solid ${C.borderSoft}; }
#${ROOT} .cms-card-header { display: grid; gap: 0.375rem; align-content: start; min-inline-size: 0; }
#${ROOT} .cms-card-title { display: flex; align-items: center; gap: 0.5rem; }
#${ROOT} .cms-card-title svg { color: ${C.muted}; }
#${ROOT} .cms-versions { grid-template-columns: repeat(2, minmax(0, 1fr)); }
#${ROOT} .cms-versions > div { min-inline-size: 0; }
#${ROOT} .cms-saved { color: ${C.text}; font-weight: 600; }
#${ROOT} .cms-radio-copy { display: grid; gap: 0.125rem; min-inline-size: 0; }
#${ROOT} .cms-radio-copy > span:first-child { font-weight: 550; }
#${ROOT} .cms-select, #${ROOT} button { font-family: inherit; font-size: ${type.body}; line-height: 1.5; }
#${ROOT} .cms-select { text-overflow: ellipsis; }
#${ROOT} .cms-field-error { font-size: ${type.detail}; color: ${C.error}; }
@container cms (inline-size >= 43rem) {
  #${ROOT} .cms-card { grid-template-columns: minmax(10rem, 1fr) minmax(0, 2.2fr); column-gap: 1.5rem; }
}
@container cms (inline-size >= 56rem) {
  #${ROOT} .cms-versions { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
#${ROOT} :is(a, button, select, summary, input):focus-visible { outline: 2px solid ${C.focus}; outline-offset: 2px; }
@media (hover: hover) {
  #${ROOT} button:enabled:hover { filter: brightness(0.92); }
  #${ROOT} summary:hover { color: ${C.text}; }
}
@media (forced-colors: active) {
  #${ROOT} :is(a, button, select, summary, input):focus-visible { outline-color: CanvasText; }
}
@media (pointer: coarse) {
  #${ROOT} :is(button, select, summary, .cms-choice) { min-block-size: 3rem; box-sizing: border-box; }
}
`
    // One consistent line-icon set: 1.8 stroke, currentColor, round caps/joins, no fills.
    const ICONS = {
      model: ['M12 3l7 4v10l-7 4-7-4V7z', 'M12 12l7-4', 'M12 12v9', 'M12 12L5 8'],
      session: ['M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H8l-4 4z'],
      users: ['M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M3 20a5 5 0 0 1 10 0', 'M16 5a3 3 0 0 1 0 6', 'M17.5 14a5 5 0 0 1 3.5 6'],
      save: ['M5 4h11l3 3v13H5z', 'M8 4v5h7V4', 'M8 20v-6h8v6'],
      reset: ['M4 10a8 8 0 1 1 2.3 6', 'M4 5v5h5'],
      check: ['M5 12.5l4.5 4.5L19 7'],
      info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M12 11v5', 'M12 8h.01'],
      refresh: ['M20 11a8 8 0 1 0-.7 4.5', 'M20 5v6h-6'],
      close: ['M4 4l16 16M20 4L4 20'],
      download: ['M12 4v10', 'M7 11l5 5 5-5', 'M5 20h14'],
    }
    function Icon({ name, size }) {
      const spec = ICONS[name] || ICONS.info
      const s = typeof size === 'number' ? size : 18
      const children = spec.map((part, index) => h('path', { key: index, d: part }))
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
    function Note({ children, error, ok, icon, announce = false }) {
      if (!children && !announce) return null
      // Keep an empty status region mounted so assistive technology can announce updates.
      return h('div', { role: announce ? 'status' : undefined, className: children ? undefined : 'cms-idle',
        style: children ? { ...S.note, ...(error ? S.noteError : ok ? S.noteOk : {}) }
          : { margin: 0, padding: 0, blockSize: 0, minBlockSize: 0, overflow: 'hidden' } },
        children && icon ? h('span', { style: { color: error ? C.error : ok ? C.ok : C.muted, display: 'inline-flex' } },
          h(Icon, { name: icon, size: 16 })) : null,
        children ? h('div', { style: { minWidth: 0, flex: '1 1 auto' } }, children) : null)
    }
    function LiveNote({ text, ...props }) {
      return h(Note, { ...props, announce: true }, text)
    }
    function Card({ title, titleId, hint, icon, headingLevel = 'h3', children }) {
      return h('section', { className: 'cms-card cms-stack' },
        h('header', { className: 'cms-card-header' },
          h('div', { className: 'cms-card-title' },
            h(Icon, { name: icon }),
            h(headingLevel, { id: titleId, style: headingLevel === 'h2' ? S.sectionHeading : S.heading }, title)),
          hint ? h('p', { style: S.hint }, hint) : null),
        h('div', { className: 'cms-stack' }, children))
    }
    function Option({ children, ...props }) {
      return h('option', Object.assign({}, props, { style: { color: C.text, background: C.surface } }), children)
    }
    // Native <select> with an explicit <label htmlFor>/id pair generated by useId.
    const Select = React.forwardRef(function Select({ label, value, disabled, onChange, children, invalid, describedBy }, selectRef) {
      const id = useId()
      return h('div', { style: S.field },
        h('label', { htmlFor: id }, label),
        h('select', { id, ref: selectRef, value, disabled, onChange: e => onChange(e.target.value), className: 'cms-select', style: S.select,
          'aria-invalid': invalid ? 'true' : undefined, 'aria-describedby': describedBy },
          children))
    })
    function Toggle({ label, checked, disabled, onChange }) {
      const id = useId()
      return h('label', { htmlFor: id, className: 'cms-choice', style: Object.assign({}, S.choice, disabled ? S.disabled : {}) },
        h('input', { id, type: 'checkbox', checked, disabled, style: S.input,
          onChange: e => onChange(e.target.checked) }),
        h('span', null, label))
    }
    function Details({ summary, children }) {
      return h('details', { style: S.details }, h('summary', { style: S.summary }, summary),
        h('div', { style: S.detailsBody }, children))
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
          const labelId = inputId + '-label'
          const hintId = inputId + '-hint'
          return h('label', { key: mode, htmlFor: inputId, className: 'cms-choice', style: S.choice },
            h('input', { id: inputId, type: 'radio', name, value: mode, checked: value === mode, disabled,
              onChange: () => onChange(mode), style: S.input, 'aria-labelledby': labelId, 'aria-describedby': hintId }),
            h('span', { className: 'cms-radio-copy' },
              h('span', { id: labelId }, t(mode)),
              h('span', { id: hintId, style: S.hint },
                t(mode === 'route' ? 'routeHint' : mode === 'parent' ? 'parentHint' : 'inheritHint'))))
        }))
    }
    function ModelPicker({ t, catalog, value, disabled, label, onChange, invalid, describedBy, selectRef }) {
      const selected = routeKey(value)
      const known = catalog.groups.some(g => (g.models || []).some(m => routeKey({ provider: g.id, model: m.id }) === selected))
      const hasRoute = !!(value.provider || value.model)
      return h(React.Fragment, null,
        h(Select, { label, value: hasRoute ? selected : '', disabled, onChange: key => onChange(routeFromKey(key)),
          invalid, describedBy, ref: selectRef },
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
    function SessionPicker({ t, rows, value, disabled, onChange }) {
      const selected = rows.find(row => row.id === value)
      const titleCounts = new Map()
      for (const row of rows) titleCounts.set(row.title, (titleCounts.get(row.title) || 0) + 1)
      return h(React.Fragment, null,
        h(Select, { label: t('target'), value: value || '', disabled: disabled || !rows.length, onChange },
          !value ? h(Option, { value: '' }, t('noSession')) : null,
          value && !selected ? h(Option, { value }, value + ' · ' + t('stale')) : null,
          rows.map(row => {
            const shortId = row.id.replace(/^session-/, '').slice(0, 8)
            const title = titleCounts.get(row.title) > 1 ? shortId + ' · ' + row.title : row.title
            return h(Option, { key: row.id, value: row.id }, row.current ? t('current') + ' · ' + title : title)
          }),
        ),
        h(SelectedSessionDetails, { t, id: value, title: selected?.title }),
        value && !selected ? h(Note, { error: true, icon: 'info' }, t('missingSession')) : null,
      )
    }
    // Shows the selected id in a small, secondary collapsible area so same-titled sessions are not confused.
    function SelectedSessionDetails({ t, id, title }) {
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
        title ? h('p', { style: S.detailsTitle }, title) : null,
        h('div', { style: S.copyRow },
          h('code', { style: S.code }, id),
          h(Button, { onClick: copy }, copied ? t('copied') : t('copyId'))),
        h(LiveNote, { error: true, icon: 'info', text: copyError ? t('copyFailed') : '' }))
    }
    // -------------------------------------------------------------------------
    // Version & update block. It owns its own fetch lifecycle: one AbortController
    // per request, aborted on unmount, and a lock so the silent auto-check cannot
    // collide with a manual re-check or an install. It only ever POSTs a relative
    // same-origin path and never merges with the panel's own refresh snapshot.
    // -------------------------------------------------------------------------
    const UPDATE_ROUTE = '/model-delegation/update'
    const STATUS_ROUTE = '/model-delegation/status'
    const TEAM_MODELS_ROUTE = '/model-delegation/team-models'
    const RELEASES_URL = 'https://github.com/WTYJ/dsh-cross-model-subagent/releases'
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

    function releaseNotesUrl(version) {
      return /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(version ?? '')
        ? RELEASES_URL + '/tag/v' + encodeURIComponent(version)
        : RELEASES_URL
    }

    function VersionBadge({ t, status }) {
      if (!UPDATE_STATUSES.includes(status)) return null
      return h('span', {
        style: Object.assign({}, S.tag, { color: updateBadgeColor(status) }),
      }, updateBadgeText(t, status))
    }
    function VersionValue({ t, value, placeholder }) {
      const unknown = typeof value !== 'string' || !value
      return unknown
        ? h('span', { style: S.hint }, placeholder || t('updateVersionUnknown'))
        : h('code', { style: S.code }, value)
    }
    // One read-only label/value line used for current/latest/checked-at/status rows.
    function VersionRow({ label, children }) {
      return h('div', null,
        h('dt', { style: S.versionLabel }, label),
        h('dd', { style: S.versionValue }, children))
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
          h('button', { type: 'button', onClick: copy, style: S.button }, copied ? t('copied') : t('copyCommand'))),
        h(LiveNote, { error: true, icon: 'info', text: copyError ? t('copyFailedManual') : '' }))
    }

    function UpdateSection({ t }) {
      const [state, setState] = useState({ phase: 'loading', data: null, error: '' })
      const [confirming, setConfirming] = useState(false)
      const [installing, setInstalling] = useState(false)
      const [outcome, setOutcome] = useState(null)
      const controller = useRef(null)
      const installButton = useRef(null)
      const restoreInstallFocus = useRef(false)
      useEffect(() => {
        if (!confirming && restoreInstallFocus.current) {
          restoreInstallFocus.current = false
          installButton.current?.focus()
        }
      }, [confirming])

      const runCheck = useCallback(async (force = false) => {
        if (controller.current) return
        const ac = new AbortController()
        controller.current = ac
        setState({ phase: 'loading', data: null, error: '' })
        setConfirming(false)
        try {
          const response = await fetch(UPDATE_ROUTE, {
            method: 'POST', credentials: 'same-origin', cache: 'no-store',
            headers: { 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ action: 'check', force }), signal: ac.signal,
          })
          const data = await readUpdateResponse(response, t)
          if (controller.current !== ac) return
          // The route may answer ok:false for a check (e.g. manager unavailable).
          if (data.ok === false) {
            setState({ phase: 'error', data: null, error: (typeof data.message === 'string' && data.message) ? data.message : t('updateCheckFailed') })
          } else {
            setState({ phase: 'ok', data, error: '' })
          }
        } catch (error) {
          if (controller.current !== ac) return
          if (error && error.name === 'AbortError') return
          setState({ phase: 'error', data: null, error: (error && error.message) || t('updateCheckFailed') })
        } finally {
          if (controller.current === ac) controller.current = null
        }
      }, [t])

      const runApply = useCallback(async () => {
        const data = state.data
        if (controller.current || !data?.spec || !data.latestVersion) return
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
          if (controller.current !== ac) return
          setOutcome({ phase: 'done', application: result.application || (result.ok ? 'applied' : 'failed'), data: result })
          setInstalling(false)
          if (controller.current === ac) controller.current = null
          // A finished install changes the on-disk version; re-run a silent check so the
          // displayed version reflects reality instead of the pre-install snapshot.
          void runCheck()
          return
        } catch (error) {
          if (controller.current !== ac) return
          if (error && error.name === 'AbortError') return
          setOutcome({ phase: 'done', application: 'failed', data: null, message: (error && error.message) || t('error') })
          setInstalling(false)
        } finally {
          if (controller.current === ac) controller.current = null
        }
      }, [state.data, runCheck, t])

      useEffect(() => {
        void runCheck()
        return () => {
          controller.current?.abort()
          controller.current = null
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [])

      const data = state.data || {}
      const status = state.phase === 'ok' ? (UPDATE_STATUSES.includes(data.status) ? data.status : 'error') : null
      const busyCheck = state.phase === 'loading'
      const checkFailed = state.phase === 'error' || status === 'error'
      const checkError = checkFailed ? state.error || data.reason || t('updateCheckFailed') : ''
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

      return h(Card, { title: t('updateTitle'), hint: t('updateHint'), icon: 'download', headingLevel: 'h2' },
        h('div', { className: 'cms-stack', 'aria-busy': installing ? 'true' : undefined },
          // While checking for the first time we still show placeholders so the layout is stable.
          h('dl', { style: S.versionBlock, className: 'cms-versions' },
            h(VersionRow, { label: t('updateCurrentVersion') },
              h(VersionValue, { t, value: busyCheck ? null : data.currentVersion, placeholder: busyCheck ? t('updateVersionPending') : t('updateVersionUnknown') })),
            h(VersionRow, { label: t('updateLatestVersion') },
              h(VersionValue, { t, value: busyCheck ? null : data.latestVersion, placeholder: busyCheck ? t('updateVersionPending') : t('updateVersionUnknown') })),
            h(VersionRow, { label: t('updateStatus') },
              busyCheck ? h('span', { style: S.hint }, t('updateCheckingShort'))
                : status ? h(VersionBadge, { t, status })
                : h('span', { style: S.hint }, t('updateBadgeError'))),
            h(VersionRow, { label: t('updateCheckedAt') },
              h('span', { style: S.hint },
                data.checkedAt ? formatCheckedAt(data.checkedAt) : t('updateCheckedNever')))),

          // Failure: persistent, readable, with an explicit retry (polite live region).
          h(LiveNote, { error: true, icon: 'info', text: checkError }),

          // The plugin is not installed through the manager at all: explain rather than
          // reporting a bare package name the user never chose.
          state.phase === 'ok' && data.installed === false
            ? h(Note, { icon: 'info' }, data.message || t('updateNotInstalled')) : null,

          // Ready: show the (truncated) release notes of the newer version.
          state.phase === 'ok' && status === 'ready' && data.notes
            ? h('p', { style: S.updateNotes, title: data.notes }, t('updateNotes') + truncateNotes(data.notes, 180))
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
            ? h('div', { className: 'cms-stack' },
              h(Note, { icon: 'info' }, t('updateMigrateIntro')),
              h(CopyCommand, { t, command: MIGRATE_COMMAND }),
              h('p', { style: S.hint }, t('updateMigrateAfter')))
            : null,

          // Keep install confirmation and retry next to the version summary.
          h('div', { style: S.row },
            canInstall
              ? (confirming
                ? h(InlineConfirm, {
                  t,
                  question: t('updateConfirmQuestion').replace('{version}', String(data.latestVersion)),
                  confirmLabel: installing ? t('updateInstalling') : t('updateConfirmInstall'),
                  busy: installDisabled,
                  onConfirm: () => { void runApply() },
                  onCancel: () => { restoreInstallFocus.current = true; setConfirming(false) },
                })
                : h('button', { ref: installButton, type: 'button', disabled: installDisabled, 'aria-busy': installing ? 'true' : undefined,
                  onClick: () => setConfirming(true),
                  style: Object.assign({}, S.button, S.primary, installDisabled ? S.disabled : {}) },
                  h(Icon, { name: 'download', size: 16 }),
                  h('span', null, t('updateInstallButton').replace('{version}', String(data.latestVersion)))))
              : null,
            h(Button, { disabled: installDisabled, onClick: () => { void runCheck(true) }, icon: 'refresh' },
              installing ? t('updateInstalling') : busyCheck ? t('updateCheckingShort') : (checkFailed ? t('updateRetry') : t('updateRecheck'))),
            h('a', { href: releaseNotesUrl(data.latestVersion || data.currentVersion), target: '_blank', rel: 'noopener noreferrer', style: S.link }, t('updateReleaseLink')),
          ),

          h(LiveNote, { ok: !installing && !outcomeError, error: outcomeError,
            icon: installing || outcomeError ? 'info' : 'check', text: installing ? t('updateInstalling') : outcomeText }),
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
        h('div', { style: S.row },
          h('button', { type: 'submit', disabled: disabled || editor.saving || !editor.dirty,
            style: Object.assign({}, S.button, S.primary, disabled || editor.saving || !editor.dirty ? S.disabled : {}) },
            h(Icon, { name: 'save', size: 16 }), h('span', null, t(editor.saving ? 'saving' : 'save'))),
          h(Button, { disabled: editor.saving || !editor.dirty, onClick: editor.discard, icon: 'reset' }, t('discard')),
        ),
        editor.conflict ? h(Button, { disabled: disabled || editor.saving, onClick: editor.rebase, icon: 'reset' }, t('rebase')) : null,
      )
    }
    function GlobalSection({ scope, snap, t, catalog, blocked, setBusy }) {
      const editor = useEditor(scope, snap, defaultValue, setBusy, t)
      const value = editor.value
      const [invalid, setInvalid] = useState(false)
      const modelRef = useRef(null)
      const modelHelpId = useId()
      const titleId = useId()
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
      return h(Card, { title: t('globalTitle'), titleId, hint: t('globalHint'), icon: 'model', headingLevel: 'h3' },
        h('form', { className: 'cms-stack', 'aria-labelledby': titleId, onSubmit: e => { e.preventDefault(); submit() }, noValidate: true },
          h(Toggle, { label: t('enable'), checked: value.routingEnabled, disabled: blocked,
            onChange: enabled => { setInvalid(false); editor.change(Object.assign({}, value, { routingEnabled: enabled })) } }),
          value.routingEnabled
            ? h(ModelPicker, { t, catalog, label: t('model'), value: { provider: value.defaultProvider, model: value.defaultModel }, disabled: blocked,
              onChange: changeRoute, invalid, describedBy: modelHelpId, selectRef: modelRef })
            : h('p', { style: S.hint }, t('off')),
          h('span', { id: modelHelpId, className: 'cms-field-error', hidden: !invalid }, invalid ? t('needModel') : ''),
          h(EditorFooter, { editor, t, disabled: blocked }),
        ),
      )
    }
    async function fetchModelSummary(route, query, signal) {
      try {
        const response = await fetch(route + '?' + query, {
          method: 'POST', credentials: 'same-origin',
          signal: AbortSignal.any([signal, AbortSignal.timeout(6500)]),
        })
        return response.ok ? await response.json() : null
      } catch {
        return null
      }
    }

    function useDelegationStatus(sessionId, revision, refreshKey) {
      const [result, setResult] = useState(null)
      useEffect(() => {
        const controller = new AbortController()
        fetchModelSummary(STATUS_ROUTE, new URLSearchParams({ sessionId }), controller.signal).then(data => {
          if (!controller.signal.aborted) setResult({ sessionId, revision, refreshKey, data })
        })
        return () => controller.abort()
      }, [sessionId, revision, refreshKey])
      return result && result.sessionId === sessionId && result.revision === revision && result.refreshKey === refreshKey
        ? result : null
    }

    function delegationState(status) {
      if (!status?.ok) return 'runtimeUnavailable'
      if (status.application === 'next-open') return 'runtimeClosed'
      if (status.mountFailed) return 'runtimeMountFailed'
      if (!status.nativeToolPresent) return 'runtimeNoTool'
      if (status.application !== 'next-subagent-call') return 'runtimeUnsupported'
      if (status.configurationInvalid || !status.selection) return 'runtimeInvalid'
      return null
    }

    function workerLabel(t, { route, source }, parentRoute) {
      const origin = t(source === 'session' ? 'runtimeSession' : source === 'global' ? 'runtimeGlobal' : 'runtimeParent')
      const model = routeLabel(route || parentRoute)
      return model ? `${model} · ${origin}` : origin
    }

    function DelegationStatus({ t, sessionId, revision, refreshKey }) {
      const result = useDelegationStatus(sessionId, revision, refreshKey)
      const reason = result ? delegationState(result.data) : null
      const text = !result ? '' : reason ? t(reason)
        : t('runtimeNext') + ' · ' + workerLabel(t, result.data.selection, result.data.parentRoute)
      return h(React.Fragment, null,
        !result ? h('p', { style: S.hint }, t('runtimeLoading')) : null,
        h(LiveNote, { icon: 'info', text }))
    }

    function ObserveTeam({ sessionId, useProjection, notifications, noticeScope }) {
      const enabled = useProjection('agentTeam', team => team?.enabled)
      const catalog = useProjection('subagentCatalog')
      const preference = useSource(noticeScope)
      const canNotify = preference.status === 'ready' && preference.value?.muteTeamNotice !== true
      useEffect(() => {
        notifications.observe(sessionId, canNotify ? enabled : false, catalog)
      }, [notifications, sessionId, canNotify, enabled, catalog])
      useEffect(() => () => notifications.unobserve(sessionId), [notifications, sessionId])
      return null
    }

    function useTeamParentModel(sessionId, refreshKey) {
      const [result, setResult] = useState(null)
      useEffect(() => {
        const controller = new AbortController()
        fetchModelSummary(STATUS_ROUTE, new URLSearchParams({ sessionId }), controller.signal).then(data => {
          if (controller.signal.aborted) return
          const model = data?.ok ? routeLabel(data.parentRoute) : ''
          setResult(previous => ({ refreshKey, model: model || previous?.model || '', failed: !data?.ok }))
        })
        return () => controller.abort()
      }, [sessionId, refreshKey])
      const pending = result?.refreshKey !== refreshKey
      return { model: result?.model, pending, failed: !pending && result.failed }
    }

    function useTeamMemberModels(sessionId, members, refreshKey) {
      const [snapshot, setSnapshot] = useState(() => ({ modelById: new Map(), key: null }))
      const known = useRef(new Map())
      // Track completed lookups per refresh so catalog changes can resume an interrupted refresh.
      const lastRefresh = useRef(new Map())
      const key = JSON.stringify([refreshKey, members.filter(row => row.mode !== 'external').map(row => row.id)])
      useEffect(() => {
        const controller = new AbortController()
        const [, ids] = JSON.parse(key)
        let timer
        let attempts = 0
        let failed = false
        async function poll(requestedIds) {
          const waiting = []
          for (let index = 0; index < requestedIds.length; index += 20) {
            const batch = requestedIds.slice(index, index + 20)
            const query = new URLSearchParams({ sessionId })
            for (const id of batch) query.append('memberId', id)
            const data = await fetchModelSummary(TEAM_MODELS_ROUTE, query, controller.signal)
            if (controller.signal.aborted) return
            if (refreshKey > 0) {
              for (const id of batch) lastRefresh.current.set(id, refreshKey)
            }
            if (data?.ok && data.enabled === false) { waiting.length = 0; break }
            const result = teamMemberBatch(batch, data, known.current)
            failed ||= result.failed
            for (const member of result.confirmed) known.current.set(member.id, member.route)
            waiting.push(...result.waiting)
          }
          const pending = waiting.length > 0 && ++attempts < 8
          setSnapshot({ key, waiting: new Set(pending ? waiting : []), failed, modelById: new Map(known.current) })
          if (pending) timer = setTimeout(() => { void poll(waiting) }, 1200)
        }
        void poll(teamMemberLookupIds(ids, known.current, refreshKey, lastRefresh.current))
        return () => { controller.abort(); clearTimeout(timer) }
      }, [sessionId, key, refreshKey])
      const checked = snapshot.key === key
      return { modelById: snapshot.modelById, checked, waiting: checked ? snapshot.waiting : null, failed: checked && snapshot.failed }
    }
    function useTeamNoticePreference(scope, t) {
      const snapshot = useSource(scope)
      const [saving, setSaving] = useState(false)
      const [error, setError] = useState('')
      const lock = useRef(false)
      const setMuted = async muted => {
        if (lock.current) return false
        const current = scope.getSnapshot()
        if (current.status !== 'ready' || !current.writable) { setError(t('readOnly')); return false }
        if ((current.value?.muteTeamNotice === true) === muted) return true
        lock.current = true
        setSaving(true)
        setError('')
        try {
          if (acceptedWrite(await scope.mutate([{ op: 'set', path: ['muteTeamNotice'], value: muted }], current.revision))) return true
          setError(t('refused'))
        } catch (failure) {
          setError(failure?.message || t('error'))
        } finally {
          lock.current = false
          setSaving(false)
        }
        return false
      }
      return { muted: snapshot.value?.muteTeamNotice === true, writable: snapshot.status === 'ready' && snapshot.writable,
        saving, error, setMuted }
    }

    function TeamNoticePreference({ t, noticeScope }) {
      const preference = useTeamNoticePreference(noticeScope, t)
      return h(Card, { title: t('teamNoticePreference'), hint: t('teamNoticePreferenceHint') },
        h(Toggle, { label: t('teamNoticeToggle'), checked: !preference.muted, disabled: !preference.writable || preference.saving,
          onChange: enabled => { void preference.setMuted(!enabled) } }),
        h(LiveNote, { error: true, text: preference.error }))
    }

    function TeamNotice({ t, notice, close, openSettings, noticeScope }) {
      const { sessionId, members } = notice
      const [refreshKey, setRefreshKey] = useState(0)
      const parent = useTeamParentModel(sessionId, refreshKey)
      const { modelById, checked, waiting, failed } = useTeamMemberModels(sessionId, members, refreshKey)
      const refreshing = refreshKey > 0 && (parent.pending || !checked)
      const loadFailed = parent.failed || failed

      const id = useId()
      const card = useRef(null)
      const focusBefore = useRef(null)
      const [navigationFailed, setNavigationFailed] = useState(false)
      const preference = useTeamNoticePreference(noticeScope, t)
      useEffect(() => {
        const element = card.current
        focusBefore.current = document.activeElement
        if (typeof element.showPopover === 'function') element.showPopover()
        return () => { if (typeof element.hidePopover === 'function') element.hidePopover() }
      }, [])
      const dismiss = () => {
        if (card.current?.contains(document.activeElement) && focusBefore.current?.isConnected) {
          focusBefore.current.focus({ preventScroll: true })
        }
        close(sessionId)
      }
      const mute = async () => { if (await preference.setMuted(true)) dismiss() }
      const position = { position: 'fixed', inset: 'auto', top: 'max(3.75rem, env(safe-area-inset-top))', right: '1rem',
        margin: 0, inlineSize: 'min(24rem, calc(100% - 2rem))', maxBlockSize: 'calc(100% - 4.75rem)', overflow: 'auto',
        boxSizing: 'border-box', padding: '0.875rem 1rem', pointerEvents: 'auto', overflowWrap: 'anywhere',
        color: C.text, background: C.surface, border: '1px solid ' + C.border, borderRadius: 'var(--dsw-radius-md, 0.75rem)',
        boxShadow: 'var(--dsw-elevation-soft)', fontSize: '0.875rem', lineHeight: 1.5, scrollbarGutter: 'stable' }
      const row = (label, model, key) => h('div', { key, style: { display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 3fr)', gap: '0.5rem' } },
        h('dt', { style: { fontWeight: 600, minWidth: 0 } }, label),
        h('dd', { style: { margin: 0, minWidth: 0, color: C.muted } }, model))
      const headerButton = { ...S.button, minInlineSize: '2.25rem', padding: '0 0.5rem' }
      return h('section', { ref: card, popover: 'manual', style: position, 'aria-labelledby': id,
        onKeyDown: event => { if (event.key === 'Escape' && !preference.saving) { event.preventDefault(); event.stopPropagation(); dismiss() } } },
        h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' } },
          h('h2', { id, style: S.teamNoticeTitle }, t('teamNoticeTitle')),
          h('div', { style: { display: 'flex', flex: '0 0 auto', gap: '0.375rem' } },
            h('button', { type: 'button', 'aria-label': t('teamNoticeRefresh'), 'aria-disabled': refreshing,
              title: t(refreshing ? 'teamNoticeRefreshing' : 'teamNoticeRefresh'),
              style: { ...headerButton, ...(refreshing ? S.disabled : {}) },
              onClick: () => { if (!refreshing) setRefreshKey(key => key + 1) } }, h(Icon, { name: 'refresh', size: 18 })),
            h('button', { type: 'button', onClick: dismiss, disabled: preference.saving, 'aria-label': t('teamNoticeClose'),
              title: t('teamNoticeClose'), style: headerButton }, h(Icon, { name: 'close', size: 18 })))),
        h('dl', { tabIndex: 0, 'aria-label': t('teamNoticeList'), 'aria-busy': refreshing,
          style: { display: 'grid', gap: '0.375rem', margin: '0.75rem 0',
            maxBlockSize: 'min(10rem, 28vh)', overflowY: 'auto', overscrollBehavior: 'contain', paddingInlineEnd: '0.25rem' } },
          row(t('teamNoticeMain'), parent.model || t(parent.pending ? 'teamNoticeWaiting' : 'teamNoticeUnavailable'), 'lead'),
          members.map(member => {
            const model = routeLabel(modelById.get(member.id))
            const pending = member.mode !== 'external' && (!waiting || waiting.has(member.id))
            if (!model && !pending) return null
            return row(member.name || member.label || member.id.replace(/^session-/, '').slice(0, 8),
              model || t('teamNoticeWaiting'), member.id)
          })),
        h('div', { style: S.row },
          openSettings ? h(Button, { primary: true, onClick: () => {
            if (openSettings(sessionId)) close(sessionId)
            else setNavigationFailed(true)
          } }, t('teamNoticeSettings')) : null,
          h(Button, { onClick: mute, disabled: preference.saving || !preference.writable }, t('teamNoticeMute'))),
        h(LiveNote, { error: true,
          text: preference.error || (navigationFailed ? t('teamNoticeNavError') : '') || (loadFailed ? t('teamNoticeRefreshFailed') : '') }))
    }

    function TeamNoticeOverlay({ t, notifications, openSettings, noticeScope }) {
      const notice = useSource(notifications)
      const message = notice ? [t('teamNoticeTitle'), openSettings ? t('teamNoticeActions') : ''].filter(Boolean).join(' · ') : ''
      const nativeAnnouncement = typeof document.ariaNotify === 'function'
      useEffect(() => {
        if (message && nativeAnnouncement) document.ariaNotify(message)
      }, [message, nativeAnnouncement])
      return h(React.Fragment, null,
        h('span', { role: 'status', style: { position: 'absolute', inlineSize: 1, blockSize: 1, overflow: 'hidden', clipPath: 'inset(50%)' } },
          nativeAnnouncement ? '' : message),
        notice ? h(TeamNotice, { key: notice.sessionId, t, notice, close: notifications.dismiss, openSettings, noticeScope }) : null)
    }

    // Renders no visible model text: the composer dock only watches the live
    // team catalog so a notice can appear when a member starts.
    function ConversationModels({ sessionId, useProjection, useSession, notifications, noticeScope }) {
      if (useSession(state => state.subagent !== null)) return null
      return h(ObserveTeam, { sessionId, useProjection, notifications, noticeScope })
    }

    function SessionSection({ scope, snap, t, catalog, rows, sessionsLoading, blocked, setBusy, refreshKey, navigation }) {
      const requestedSession = useSource(navigation)
      const [chosen, setChosen] = useState(() => requestedSession?.sessionId ?? '')
      const activeId = chosen || (rows.find(row => row.current) || rows[0] || {}).id || ''
      const editor = useEditor(scope, snap, value => sessionValue(value, activeId), setBusy, t)
      const value = editor.value
      const present = rows.some(row => row.id === activeId)
      const [invalid, setInvalid] = useState(false)
      const modelRef = useRef(null)
      const modeHelpId = useId()
      const modelErrId = useId()
      const titleId = useId()
      useEffect(() => {
        if (!requestedSession || editor.dirty) return
        setChosen(requestedSession.sessionId)
        setInvalid(false)
        navigation.consume(requestedSession)
      }, [requestedSession, editor.dirty, navigation])
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
      return h(Card, { title: t('sessionTitle'), titleId, hint: t('sessionHint'), icon: 'session', headingLevel: 'h3' },
        sessionsLoading ? h(Note, { icon: 'info' }, t('sessionLoading')) : null,
        !rows.length && !activeId ? h(Note, { icon: 'info' }, t('noSession')) : null,
        h(SessionPicker, { t, rows, value: activeId, disabled: blocked || editor.dirty, onChange: id => { setChosen(id); editor.discard(); setInvalid(false) } }),
        editor.dirty ? h('p', { style: S.hint }, t('switchProtected')) : null,
        activeId ? h('form', { className: 'cms-stack', 'aria-labelledby': titleId, onSubmit: e => { e.preventDefault(); submit() }, noValidate: true },
          h('p', { style: S.effective }, t('effective'), h('strong', { className: 'cms-saved' }, behavior)),
          present && snap.status === 'ready' ? h(DelegationStatus, { t, sessionId: activeId, revision: snap.revision, refreshKey }) : null,
          h(ModeRadio, { t, value: value.mode, disabled: blocked || !present, onChange: mode => change({ mode, provider: mode === 'route' ? value.provider : '', model: mode === 'route' ? value.model : '' }), describedBy: modeHelpId }),
          h('span', { id: modeHelpId, style: { display: 'none' } }, t('modeHelp')),
          value.mode === 'route' ? h(ModelPicker, { t, catalog, label: t('sessionModel'), value, disabled: blocked || !present,
            onChange: route => { setInvalid(false); change(Object.assign({}, route, { mode: 'route' })) }, invalid, describedBy: modelErrId, selectRef: modelRef }) : null,
          h('span', { id: modelErrId, className: 'cms-field-error', hidden: !invalid }, invalid ? t('needModel') : ''),
          h(EditorFooter, { editor, t, disabled: blocked || !present }),
        ) : null,
      )
    }
    function ForceSection({ scope, snap, t, blocked, setBusy }) {
      const titleId = useId()
      const editor = useEditor(scope, snap, value => value.forceAgentTeams === true, setBusy, t)
      return h(Card, { title: t('forceTitle'), titleId, hint: t('forceHint'), icon: 'users', headingLevel: 'h3' },
        h('form', { className: 'cms-stack', 'aria-labelledby': titleId, onSubmit: e => { e.preventDefault(); if (blocked) return; void editor.save([{ op: 'set', path: ['forceAgentTeams'], value: editor.value }]) } },
          h(Toggle, { label: t('forceLabel'), checked: editor.value, disabled: blocked, onChange: editor.change }),
          h('p', { style: S.hint }, t('teamsOfficial')),
          h(EditorFooter, { editor, t, disabled: blocked }),
        ),
      )
    }
    function Panel({ ctx, t, useSessions, navigation, noticeScope }) {
      const scope = useMemo(() => ctx.configForms.get(CONFIG), [ctx])
      const mirror = useMemo(() => ctx.configForms.describe(), [ctx])
      const snap = useSource(scope)
      const mirrorSnap = useSource(mirror)
      const sessions = useSessions(state => state)
      const hookRows = sessionRows(sessions)
      const [freshIds, setFreshIds] = useState(null)
      const [catalog, setCatalog] = useState({ groups: [], loading: true, loaded: false })
      const [refreshing, setRefreshing] = useState(false)
      const [refreshKey, setRefreshKey] = useState(0)
      const [refreshMessage, setRefreshMessage] = useState('')
      const [refreshError, setRefreshError] = useState('')
      const [availability, setAvailability] = useState({ present: null, writable: null, mirrorView: null })
      const [busyCount, setBusyCount] = useState(0)
      const busy = useCallback(active => setBusyCount(n => Math.max(0, n + (active ? 1 : -1))), [])
      const refreshLock = useRef(false)
      const alive = useRef(true)
      const refreshTimer = useRef(null)
      const modelsTitleId = useId()
      const clearRefreshTimer = () => { if (refreshTimer.current) { clearTimeout(refreshTimer.current); refreshTimer.current = null } }
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
        setRefreshKey(key => key + 1); setRefreshing(false); refreshLock.current = false
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
              h('h1', { style: S.title }, t('panelTitle')),
              h('p', { style: S.sub }, t('intro'))),
            h('button', { type: 'button', title: t('refresh'), 'aria-label': t('refresh'),
              disabled: refreshing || busyCount > 0, onClick: () => { void refresh(true) },
              style: Object.assign({}, S.button, refreshing || busyCount > 0 ? S.disabled : {}) },
              h(Icon, { name: 'refresh', size: 16 }),
              h('span', null, t(refreshing ? 'refreshing' : 'refreshAction')))),
          h('div', { className: 'cms-stack cms-feedback' },
            h(LiveNote, { ok: true, icon: 'check', text: refreshMessage }),
            h(LiveNote, { error: true, icon: 'info', text: refreshError || (availability.present && availability.mirrorSnapshot === mirrorSnap ? '' : mirrorSnap.error) }),
            h(Note, { icon: 'info' }, snap.status === 'loading' ? t('configLoading') : missing ? t('unavailable') : !writable ? t('readOnly') : ''),
            snap.value && snap.value.sessionRoutesJson && snap.value.sessionRoutesJson !== '{}' ? h(Note, { icon: 'info' }, t('legacy')) : null),
          h('section', { 'aria-labelledby': modelsTitleId },
            h('h2', { style: S.groupTitle, id: modelsTitleId }, t('workerSettings')),
            h('div', { style: S.card },
              h(SessionSection, { scope, snap, t, catalog, rows, sessionsLoading: !sessions || sessions.phase === 'pending', blocked, setBusy: busy, refreshKey, navigation }),
              h(GlobalSection, { scope, snap, t, catalog, blocked, setBusy: busy }))),
          h('section', null,
            h('h2', { style: S.groupTitle }, t('teamsTitle')),
            h('div', { style: S.card },
              h(ForceSection, { scope, snap, t, blocked, setBusy: busy }),
               h(TeamNoticePreference, { t, noticeScope }))),
          h('div', { style: S.card }, h(UpdateSection, { t })),
          h(Details, { summary: t('details') }, t('scopeHint')),
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
      inject: ['slots', 'layout', 'locale', 'configForms', 'sessions', 'remote', 'remote.session', 'remote.settings'],
      apply(ctx) {
        const ID = 'cross_model_subagent_settings'
        const t = ctx.locale.bind(NS)
        ctx.effect(() => ctx.locale.register(NS, dict), 'cross-model-subagent: dictionaries')
        const notifications = teamNotifications()
        const noticeScope = ctx.configForms.get(CONFIG)
        const layout = ctx.get('layout')
        let target = null
        const navigationListeners = new Set()
        function setTarget(value) {
          target = value
          for (const notify of navigationListeners) notify()
        }
        const navigation = {
          getSnapshot: () => target,
          subscribe(fn) { navigationListeners.add(fn); return () => navigationListeners.delete(fn) },
          consume(request) { if (target === request) setTarget(null) },
        }
        function openSettings(sessionId) {
          try { layout.selectPanel(ID) } catch { return false }
          setTarget({ sessionId })
          return true
        }
        function PanelBound(props) { return h(Panel, { ctx, t, useSessions: props.useSessions, navigation, noticeScope }) }
        function ConversationModelsBound(props) { return h(ConversationModels, { sessionId: props.sessionId, useProjection: props.useProjection, useSession: props.useSession, notifications, noticeScope }) }
        function TeamNoticeBound() { return h(TeamNoticeOverlay, { t, notifications, openSettings: layout ? openSettings : null, noticeScope }) }
        ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay', id: 'cross-model-subagent-team-notice', locale: NS,
        }, TeamNoticeBound)), 'cross-model-subagent: team notice')
        ctx.effect(() => ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock', id: 'cross-model-subagent-summary', order: 5, locale: NS,
        }, ConversationModelsBound)), 'cross-model-subagent: conversation models')
        ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: ID, locale: NS }, PanelBound)), 'cross-model-subagent: main panel')
        ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: ID, order: 5, label: () => t('panelIcon'), locale: NS }, PanelIcon)), 'cross-model-subagent: sidebar entry')
      },
    }
  },
})
