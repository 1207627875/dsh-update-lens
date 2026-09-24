/**
 * dsh-update-lens — browser half.
 *
 * Adds one page to Settings ("更新中心" / "Update center") plus an in-app
 * notification when a newer official dsh exists. Every number on the page comes
 * from the Host half's own routes; this file never talks to the internet itself,
 * so the browser's CORS/proxy situation is irrelevant.
 *
 * Built as a plain module-table entry (no bundler): `require('react')` is served
 * by the browser module table.
 */
window.__ModuleLoader__.load({
  id: 'dsh-update-lens',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    const NS = 'dsh-update-lens';
    const API = '/dsh-update-lens';
    const POLL_MS = 90_000;
    const SECTION_ID = 'update-center';
    const SECTION_ORDER = 160;
    /**
     * Which browser-side build this is. Every poll reports it to the Host, so
     * "is the open page running the current client bundle or a stale one?" has
     * an answer that does not depend on guesswork. Bump on every client change.
     */
    const CLIENT_REV = '1.0.1';

    // ---------------------------------------------------------------------
    // text
    // ---------------------------------------------------------------------
    const ZH = {
      nav: '更新中心',
      navBadge: '更新中心 ●',
      title: 'DSH 更新中心',
      subtitle: '只做检查与通知，绝不自动更新。发现新版本后由你自己决定何时升级。',
      checking: '检查中…',
      checkNow: '立即检查',
      neverChecked: '尚未检查',
      lastChecked: '上次检查',
      upToDate: '已是最新',
      updateAvailable: '有新版本',
      updateAvailableCount: '有 {n} 个新版本',
      checkFailed: '检查失败',
      current: '当前版本',
      target: '最新版本',
      channel: '通道',
      published: '发布时间',
      versionsBehind: '落后 {n} 个版本',
      otherChannel: '其他通道另有更新版本 {v}',
      downgradeTitle: '注意：不要直接执行裸安装命令',
      downgradeBody: 'npm 的 {tags} 标签当前指向 {v}，低于你已安装的 {cur} —— `npm i -g @deepseek-ai/dsh` 会让你降级。请使用下面带版本号或带标签的命令。',
      notesTitle: '更新内容',
      notesCurrent: '当前版本说明',
      notesEmpty: '没有比当前版本更新的版本，无需查看。',
      notesUnavailable: '暂时取不到更新内容：GitHub 不可达。版本检测走 npm registry（无需代理），但 Release 说明只在 GitHub 上。可在此页配置代理或镜像地址后重试。',
      openRelease: '打开 Release 页面',
      levelBreaking: '破坏性',
      levelCaution: '注意',
      riskBreakingCount: '{n} 条破坏性变更',
      riskCautionCount: '{n} 条需留意',
      onlyRisk: '只看风险项',
      showAll: '显示全部',
      matchedWords: '命中',
      noRiskFlagged: '本条未标注风险项。',
      breakingBanner: '待升级的版本含 {n} 条破坏性变更，升级前建议先看下面的「更新内容」。',
      showCn: '中文',
      showEn: 'English',
      sourcesTitle: '网络来源',
      sourceOk: '正常',
      sourceFail: '失败',
      proxyTitle: '出口策略',
      proxyDirect: '直连（未使用代理）',
      proxyVia: '经代理 {url}（来源：{src}）',
      proxyEnv: '启动环境变量',
      proxySettings: '插件设置',
      proxyDefault: '默认直连',
      proxyUnusable: '代理不可用，已回退直连：',
      viaProxy: '代理',
      viaDirect: '直连',
      proxyProbe: '检测本地代理端口',
      proxyProbeNone: '没有检测到正在监听的常见本地代理端口。',
      proxyProbeFound: '检测到可用本地代理：',
      proxyProbeUse: '使用它',
      settingsTitle: '设置',
      setEnabled: '启用后台自动检查',
      setInterval: '检查间隔（分钟）',
      setChannel: '检查范围',
      channelFollow: '跟随当前通道',
      channelNewest: '任意通道的最新版',
      setNotify: '发现新版本时弹出提醒',
      setProxy: 'HTTP(S) 代理（留空 = 直连）',
      setGithubBase: 'GitHub API 地址（可填镜像）',
      save: '保存',
      saved: '已保存',
      cancel: '取消',
      commandTitle: '手动更新命令',
      commandHint: '复制到终端执行（本插件不会替你执行）：',
      copy: '复制',
      copied: '已复制',
      bareWarning: '裸命令会安装 latest 标签，可能低于当前版本。',
      runtimeTitle: '运行环境',
      node: 'Node',
      platform: '平台',
      dshHome: 'DSH_HOME',
      detectedAt: '检测来源',
      clientRev: '客户端版本',
      newVersionToast: 'DSH 有新版本 {v}',
      toastBody: '当前 {cur}，可升级到 {v}。升级命令请点“复制命令”。',
      copyCommand: '复制命令',
      dismiss: '忽略此版本',
      ignoreVersion: '忽略',
      ignoreHint: '把这个版本的卡片收起来（可随时恢复）',
      ignoredLine: '已忽略 {n} 个版本的卡片',
      restoreAll: '全部恢复',
      notesUnavailableShort: '正文暂不可用（GitHub 不可达）',
      details: '查看详情',
      vpnHint: '版本号来自 npm registry，国内可直连；更新内容来自 GitHub Releases，若打不开 GitHub 请在上面配置本地代理或镜像。',
    };

    const EN = {
      nav: 'Update center',
      navBadge: 'Update center ●',
      title: 'DSH update center',
      subtitle: 'Checks and notifies only — it never updates anything for you.',
      checking: 'Checking…',
      checkNow: 'Check now',
      neverChecked: 'Not checked yet',
      lastChecked: 'Last checked',
      upToDate: 'Up to date',
      updateAvailable: 'Update available',
      updateAvailableCount: '{n} newer versions',
      checkFailed: 'Check failed',
      current: 'Installed',
      target: 'Latest',
      channel: 'Channel',
      published: 'Published',
      versionsBehind: '{n} versions behind',
      otherChannel: 'Another channel has {v}',
      downgradeTitle: 'Do not run the bare install command',
      downgradeBody: 'The {tags} dist-tag points at {v}, below your installed {cur} — `npm i -g @deepseek-ai/dsh` would downgrade you. Use a pinned or tagged command below.',
      notesTitle: 'What changed',
      notesCurrent: 'Notes for the installed version',
      notesEmpty: 'Nothing newer than the installed build.',
      notesUnavailable: 'Release notes are unavailable: GitHub is unreachable. Version detection uses the npm registry (no proxy needed), but release bodies live on GitHub only. Configure a proxy or mirror below and retry.',
      openRelease: 'Open release page',
      levelBreaking: 'Breaking',
      levelCaution: 'Caution',
      riskBreakingCount: '{n} breaking',
      riskCautionCount: '{n} to review',
      onlyRisk: 'Only flagged',
      showAll: 'Show all',
      matchedWords: 'Matched',
      noRiskFlagged: 'Nothing flagged in this release.',
      breakingBanner: 'The version you would upgrade to carries {n} breaking changes — read the notes below before updating.',
      showCn: '中文',
      showEn: 'English',
      sourcesTitle: 'Network sources',
      sourceOk: 'ok',
      sourceFail: 'failed',
      proxyTitle: 'Outbound policy',
      proxyDirect: 'Direct (no proxy)',
      proxyVia: 'Via {url} (source: {src})',
      proxyEnv: 'launch environment',
      proxySettings: 'plugin settings',
      proxyDefault: 'default',
      proxyUnusable: 'Proxy unusable, fell back to direct:',
      viaProxy: 'proxy',
      viaDirect: 'direct',
      proxyProbe: 'Detect local proxy ports',
      proxyProbeNone: 'No well-known local proxy port is listening.',
      proxyProbeFound: 'Listening local proxies:',
      proxyProbeUse: 'Use it',
      settingsTitle: 'Settings',
      setEnabled: 'Background automatic check',
      setInterval: 'Interval (minutes)',
      setChannel: 'Check scope',
      channelFollow: 'Follow the installed channel',
      channelNewest: 'Newest across every channel',
      setNotify: 'Notify me when a newer version appears',
      setProxy: 'HTTP(S) proxy (empty = direct)',
      setGithubBase: 'GitHub API base (mirror allowed)',
      save: 'Save',
      saved: 'Saved',
      cancel: 'Cancel',
      commandTitle: 'Manual update command',
      commandHint: 'Copy and run it yourself — this plugin never executes it:',
      copy: 'Copy',
      copied: 'Copied',
      bareWarning: 'The bare command installs the latest tag, which may be older than what you run.',
      runtimeTitle: 'Runtime',
      node: 'Node',
      platform: 'Platform',
      dshHome: 'DSH_HOME',
      detectedAt: 'Detected via',
      clientRev: 'Client build',
      newVersionToast: 'DSH {v} is available',
      toastBody: 'You run {cur}; {v} is out. Copy the update command and run it yourself.',
      copyCommand: 'Copy command',
      dismiss: 'Ignore this version',
      ignoreVersion: 'Hide',
      ignoreHint: 'Collapse this version’s card (restorable at any time)',
      ignoredLine: '{n} version card(s) hidden',
      restoreAll: 'Restore all',
      notesUnavailableShort: 'Body unavailable (GitHub unreachable)',
      details: 'Details',
      vpnHint: 'Version numbers come from the npm registry (directly reachable in China); release bodies come from GitHub Releases — if GitHub is blocked, set a local proxy or mirror above.',
    };

    // ---------------------------------------------------------------------
    // store
    // ---------------------------------------------------------------------
    let listeners = new Set();
    let badgeVersion = null;
    let store = {
      status: null,
      error: null,
      busy: false,
      noteLang: 'cn',
      onlyRisk: false,
      notice: null,
    };

    function emit() {
      for (const listener of Array.from(listeners)) {
        try {
          listener();
        } catch {
          /* a broken subscriber must not stop the others */
        }
      }
    }

    function patch(next) {
      store = { ...store, ...next };
      emit();
    }

    function describeError(error) {
      return error instanceof Error ? error.message : String(error);
    }

    async function call(path, init) {
      const response = await fetch(`${API}${path}`, init);
      let body = null;
      try {
        body = await response.json();
      } catch {
        throw new Error(`HTTP ${response.status}`);
      }
      if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`);
      return body;
    }

    async function loadStatus() {
      try {
        const status = await call(`/status?client=${encodeURIComponent(CLIENT_REV)}`, { cache: 'no-store' });
        const nextBadge = status.updateAvailable && status.config?.dismissedVersion !== status.target?.version
          ? status.target?.version ?? null
          : null;
        const badgeChanged = nextBadge !== badgeVersion;
        badgeVersion = nextBadge;
        patch({ status, error: null });
        if (badgeChanged) notifyBadgeChanged();
      } catch (error) {
        patch({ error: describeError(error) });
      }
    }

    async function checkNow() {
      patch({ busy: true });
      try {
        const status = await call(`/check?client=${encodeURIComponent(CLIENT_REV)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
        badgeVersion = status.updateAvailable && status.config?.dismissedVersion !== status.target?.version
          ? status.target?.version ?? null
          : null;
        patch({ status, error: null, busy: false });
        notifyBadgeChanged();
      } catch (error) {
        patch({ error: describeError(error), busy: false });
      }
    }

    async function saveConfig(next) {
      try {
        const result = await call('/config', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(next),
        });
        patch({ status: result.status ?? store.status, notice: 'saved' });
        notifyBadgeChanged();
      } catch (error) {
        patch({ error: describeError(error) });
      }
    }

    /** Hide (or restore) one version's notes card; the Host owns the persisted list. */
    async function setIgnored(version, ignored) {
      try {
        const result = await call('/ignore', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(ignored ? { version, ignored: true } : { version, ignored: false }),
        });
        if (result.status) patch({ status: result.status });
        await loadStatus();
      } catch (error) {
        patch({ error: describeError(error) });
      }
    }

    async function restoreIgnored() {
      try {
        const result = await call('/ignore', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ restoreAll: true }),
        });
        if (result.status) patch({ status: result.status });
        await loadStatus();
      } catch (error) {
        patch({ error: describeError(error) });
      }
    }

    async function dismiss(version) {
      try {
        await call('/dismiss', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ version }),
        });
        badgeVersion = null;
        patch({ status: store.status ? { ...store.status, config: { ...store.status.config, dismissedVersion: version } } : null });
        notifyBadgeChanged();
      } catch (error) {
        patch({ error: describeError(error) });
      }
    }

    /** Set by apply(); lets a badge change bump the shell's slot ledger. */
    let onBadgeChanged = null;
    function notifyBadgeChanged() {
      if (typeof onBadgeChanged === 'function') onBadgeChanged();
    }

    // ---------------------------------------------------------------------
    // styles (theme tokens only, so skins and light/dark both apply)
    // ---------------------------------------------------------------------
    const S = {
      page: { display: 'flex', flexDirection: 'column', gap: '18px', padding: '4px 2px 40px', color: 'var(--dsw-alias-label-primary)', fontSize: '13px', lineHeight: 1.55 },
      card: { border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-1)', borderRadius: '12px', padding: '14px 16px' },
      titleRow: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' },
      h1: { fontSize: '16px', fontWeight: 600, margin: 0 },
      h2: { fontSize: '13px', fontWeight: 600, margin: '0 0 10px' },
      muted: { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px' },
      grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px' },
      cell: { border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-layer-2)', borderRadius: '10px', padding: '10px 12px' },
      cellLabel: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', marginBottom: '4px' },
      cellValue: { fontSize: '14px', fontWeight: 600, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', wordBreak: 'break-all' },
      pill: { display: 'inline-flex', alignItems: 'center', gap: '6px', borderRadius: '999px', padding: '2px 10px', fontSize: '12px', fontWeight: 600, border: '1px solid transparent' },
      button: { border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', borderRadius: '8px', padding: '5px 12px', fontSize: '12px', cursor: 'pointer' },
      buttonPrimary: { border: '1px solid transparent', background: 'var(--dsw-alias-brand-primary)', color: '#fff', borderRadius: '8px', padding: '5px 12px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' },
      input: { border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)', borderRadius: '8px', padding: '5px 8px', fontSize: '12px', width: '100%', boxSizing: 'border-box' },
      row: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' },
      between: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' },
      pre: { margin: 0, padding: '10px 12px', background: 'var(--dsw-alias-bg-base)', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: '8px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: '12px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
      noteHeading: { fontWeight: 700, marginTop: '10px', fontSize: '12.5px' },
      badge: { display: 'inline-block', marginLeft: '6px', padding: '0 6px', borderRadius: '999px', border: '1px solid', fontSize: '11px', lineHeight: '16px', whiteSpace: 'nowrap' },
      riskBanner: { marginTop: '8px', padding: '7px 10px', borderRadius: '10px', border: '1px solid', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
      notePara: { marginTop: '3px' },
      noteItem: { display: 'flex', gap: '7px', marginTop: '3px' },
      bullet: { color: 'var(--dsw-alias-brand-primary)', flex: '0 0 auto' },
      warn: { border: '1px solid var(--dsw-alias-state-warn-primary)', background: 'color-mix(in srgb, var(--dsw-alias-state-warn-primary) 10%, transparent)', borderRadius: '12px', padding: '12px 14px' },
      // shell.overlay is a click-through layer: an occupant must opt back into
      // pointer events or its own buttons are dead.
      toast: { position: 'fixed', right: '18px', bottom: '18px', zIndex: 60, pointerEvents: 'auto', width: '344px', maxWidth: 'calc(100vw - 36px)', border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-overlay)', color: 'var(--dsw-alias-label-primary)', borderRadius: '12px', padding: '13px 14px', boxShadow: '0 12px 32px rgba(0,0,0,0.22)', fontSize: '13px' },
      sourceRow: { display: 'flex', alignItems: 'baseline', gap: '8px', padding: '4px 0', borderTop: '1px dashed var(--dsw-alias-border-l1)' },
      code: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: '12px' },
      summary: { cursor: 'pointer', fontWeight: 600, fontSize: '12.5px' },
    };

    function pill(kind, text) {
      const tone = kind === 'ok'
        ? { color: 'var(--dsw-alias-state-success-primary)', borderColor: 'var(--dsw-alias-state-success-primary)' }
        : kind === 'warn'
          ? { color: 'var(--dsw-alias-state-warn-primary)', borderColor: 'var(--dsw-alias-state-warn-primary)' }
          : kind === 'fail'
            ? { color: 'var(--dsw-alias-state-error-primary)', borderColor: 'var(--dsw-alias-state-error-primary)' }
            : { color: 'var(--dsw-alias-label-secondary)', borderColor: 'var(--dsw-alias-border-l2)' };
      return h('span', { style: { ...S.pill, ...tone } }, text);
    }

    function formatTime(value) {
      if (typeof value !== 'string' || value === '') return '—';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return value;
      const pad = n => String(n).padStart(2, '0');
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    function renderInline(text, keyBase) {
      const parts = String(text).split('**');
      return parts.map((part, index) => (index % 2 === 1 ? h('strong', { key: `${keyBase}-b${index}` }, part) : part));
    }

    /**
     * Structured, annotated blocks come from the Host (notes.js). The fallback
     * parses the raw text, so a page served by an older Host generation still
     * renders — just without the flags.
     */
    function blocksFor(entry, lang) {
      const structured = entry[`${lang}Blocks`];
      if (Array.isArray(structured)) return structured;
      const out = [];
      for (const raw of String(entry[lang] ?? '').split('\n')) {
        const line = raw.trim();
        if (line === '') continue;
        if (line.startsWith('#')) {
          out.push({ kind: 'heading', text: line.replace(/^#+\s*/, ''), level: null, words: [] });
          continue;
        }
        const bullet = line.startsWith('- ') || line.startsWith('* ');
        out.push({ kind: bullet ? 'item' : 'para', text: bullet ? line.slice(2) : line, level: null, words: [] });
      }
      return out;
    }

    /** Only the flagged items, each keeping the heading that introduces it. */
    function riskOnly(blocks) {
      const out = [];
      let pending = null;
      let pushed = false;
      for (const block of blocks) {
        if (block.kind === 'heading') {
          pending = block;
          pushed = false;
          continue;
        }
        if (block.level !== 'breaking' && block.level !== 'caution') continue;
        if (!pushed && pending !== null) {
          out.push(pending);
          pushed = true;
        }
        out.push(block);
      }
      return out;
    }

    function riskTone(level) {
      if (level === 'breaking') return 'var(--dsw-alias-state-error-primary)';
      if (level === 'caution') return 'var(--dsw-alias-state-warn-primary)';
      return null;
    }

    function riskCount(blocks, level) {
      return blocks.filter(block => block.level === level).length;
    }

    function renderBlocks(blocks, keyBase, t) {
      return blocks.map((block, index) => {
        const key = `${keyBase}-${index}`;
        if (block.kind === 'heading') return h('div', { key, style: S.noteHeading }, block.text);
        const tone = riskTone(block.level);
        const label = block.level === 'breaking' ? t('levelBreaking') : block.level === 'caution' ? t('levelCaution') : null;
        const content = [
          h('span', { key: 't' }, renderInline(block.text, key)),
          label === null ? null : h('span', { key: 'b', style: { ...S.badge, color: tone, borderColor: tone } }, label),
        ];
        if (block.kind !== 'item') return h('div', { key, style: S.notePara }, content);
        return h('div', {
          key,
          title: Array.isArray(block.words) && block.words.length > 0 ? `${t('matchedWords')}: ${block.words.join(' · ')}` : undefined,
          style: { ...S.noteItem, ...(tone === null ? {} : { borderLeft: `2px solid ${tone}`, paddingLeft: '8px', marginLeft: '-10px' }) },
        }, [
          h('span', { key: 'm', style: { ...S.bullet, color: tone ?? undefined } }, block.level === 'breaking' ? '▲' : block.level === 'caution' ? '!' : '•'),
          h('span', { key: 'c' }, content),
        ]);
      });
    }

    function useStore() {
      const [snapshot, setSnapshot] = React.useState(store);
      React.useEffect(() => {
        const listener = () => setSnapshot(store);
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      }, []);
      return snapshot;
    }

    function interpolate(text, values) {
      return String(text).replace(/\{(\w+)\}/g, (match, key) => (values[key] === undefined ? match : String(values[key])));
    }

    function CommandRow(props) {
      const { t, command, note, tone } = props;
      const [copied, setCopied] = React.useState(false);
      const copy = async () => {
        try {
          await navigator.clipboard.writeText(command);
        } catch {
          const area = document.createElement('textarea');
          area.value = command;
          document.body.appendChild(area);
          area.select();
          try {
            document.execCommand('copy');
          } catch {
            /* clipboard unavailable */
          }
          document.body.removeChild(area);
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      };
      return h('div', { style: { marginTop: '8px' } }, [
        h('div', { key: 'c', style: S.row }, [
          h('code', { key: 'code', style: { ...S.pre, flex: '1 1 320px' } }, command),
          h('button', { key: 'btn', type: 'button', style: S.button, onClick: copy }, copied ? t('copied') : t('copy')),
        ]),
        note ? h('div', { key: 'n', style: { ...S.muted, marginTop: '3px', color: tone === 'warn' ? 'var(--dsw-alias-state-warn-primary)' : undefined } }, note) : null,
      ]);
    }

    function SourceList(props) {
      const { t, status } = props;
      if (!Array.isArray(status.sources) || status.sources.length === 0) {
        return h('div', { style: S.muted }, t('neverChecked'));
      }
      const proxy = status.proxy ?? {};
      const proxyText = proxy.mode === 'proxy'
        ? interpolate(t('proxyVia'), { url: proxy.url, src: proxy.source === 'environment' ? t('proxyEnv') : t('proxySettings') })
        : t('proxyDirect');
      const proxyBroken = proxy.mode === 'proxy' && proxy.available === false;
      return h('div', {}, [
        h('div', { key: 'p', style: { ...S.row, marginBottom: '6px' } }, [
          h('span', { key: 'l', style: S.muted }, `${t('proxyTitle')}:`),
          h('span', { key: 'v', style: S.code }, proxyText),
        ]),
        proxyBroken
          ? h('div', {
            key: 'w',
            style: {
              ...S.riskBanner,
              borderColor: 'var(--dsw-alias-state-warn-primary)',
              background: 'color-mix(in srgb, var(--dsw-alias-state-warn-primary) 9%, transparent)',
              color: 'var(--dsw-alias-state-warn-primary)',
            },
          }, ['!', h('span', { key: 't' }, `${t('proxyUnusable')} ${proxy.error ?? ''}`)])
          : null,
        ...status.sources.map((source, index) => h('div', { key: `${source.id}-${index}`, style: S.sourceRow }, [
          h('span', { key: 's', style: { flex: '0 0 auto' } }, source.ok ? pill('ok', t('sourceOk')) : pill('fail', t('sourceFail'))),
          h('span', { key: 'l', style: { flex: '1 1 160px' } }, source.label),
          h('span', { key: 'v', style: { ...S.muted, flex: '0 0 auto' } }, source.via === 'proxy' ? t('viaProxy') : t('viaDirect')),
          h('span', { key: 'm', style: { ...S.muted, ...S.code, flex: '0 0 auto' } }, `${source.ms}ms`),
          h('span', { key: 'e', style: { ...S.muted, ...S.code, flex: '1 1 200px', textAlign: 'right' } }, source.error ?? source.note ?? source.url),
        ])),
      ]);
    }

    function NotesCard(props) {
      const { t, entry, lang, onToggleLang, keyBase, title, onlyRisk, onToggleRisk, onIgnore, compact } = props;
      const blocks = blocksFor(entry, lang);
      const breaking = riskCount(blocks, 'breaking');
      const caution = riskCount(blocks, 'caution');
      const flagged = breaking + caution;
      const visible = onlyRisk ? riskOnly(blocks) : blocks;
      const summaryRow = flagged === 0
        ? h('div', { key: 'sum', style: { ...S.muted, marginTop: '6px' } }, t('noRiskFlagged'))
        : h('div', {
          key: 'sum',
          style: {
            ...S.riskBanner,
            borderColor: breaking > 0 ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-state-warn-primary)',
            background: `color-mix(in srgb, ${breaking > 0 ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-state-warn-primary)'} 9%, transparent)`,
          },
        }, [
          h('span', { key: 'k' }, breaking > 0 ? '⚠' : '!'),
          breaking > 0 ? h('span', { key: 'b', style: { color: 'var(--dsw-alias-state-error-primary)', fontWeight: 600 } }, interpolate(t('riskBreakingCount'), { n: breaking })) : null,
          caution > 0 ? h('span', { key: 'c', style: { color: 'var(--dsw-alias-state-warn-primary)' } }, interpolate(t('riskCautionCount'), { n: caution })) : null,
          onToggleRisk
            ? h('button', { key: 'f', type: 'button', style: { ...S.button, marginLeft: 'auto' }, onClick: () => onToggleRisk(!onlyRisk) }, onlyRisk ? t('showAll') : t('onlyRisk'))
            : null,
        ]);
      return h('div', { style: { ...S.card, marginTop: '10px' } }, [
        h('div', { key: 'head', style: S.between }, [
          h('div', { key: 'l', style: S.row }, [
            h('strong', { key: 'v', style: S.code }, entry.version),
            entry.publishedAt ? h('span', { key: 'd', style: S.muted }, formatTime(entry.publishedAt)) : null,
            title ? h('span', { key: 't', style: S.muted }, title) : null,
          ]),
          h('div', { key: 'r', style: S.row }, [
            h('button', {
              key: 'cn',
              type: 'button',
              style: lang === 'cn' ? S.buttonPrimary : S.button,
              onClick: () => onToggleLang('cn'),
            }, t('showCn')),
            h('button', {
              key: 'en',
              type: 'button',
              style: lang === 'en' ? S.buttonPrimary : S.button,
              onClick: () => onToggleLang('en'),
            }, t('showEn')),
            entry.url ? h('a', { key: 'a', href: entry.url, target: '_blank', rel: 'noreferrer', style: { ...S.muted, textDecoration: 'underline' } }, t('openRelease')) : null,
            onIgnore
              ? h('button', {
                key: 'x',
                type: 'button',
                style: S.button,
                title: t('ignoreHint'),
                onClick: () => onIgnore(entry.version),
              }, t('ignoreVersion'))
              : null,
          ]),
        ]),
        blocks.length === 0
          ? h('div', { key: 'body', style: { ...S.muted, marginTop: '8px' } }, compact ? t('notesUnavailableShort') : t('notesUnavailable'))
          : h('div', { key: 'body' }, [summaryRow, h('div', { key: 'blocks', style: { marginTop: '6px' } }, renderBlocks(visible, `${keyBase}-${entry.version}`, t))]),
      ]);
    }

    function Section(props) {
      const { t, client } = props;
      const snapshot = useStore();
      const status = snapshot.status;
      const [proxyDraft, setProxyDraft] = React.useState(null);
      const [baseDraft, setBaseDraft] = React.useState(null);
      const [intervalDraft, setIntervalDraft] = React.useState(null);
      const [probes, setProbes] = React.useState(null);
      const [showCurrentNotes, setShowCurrentNotes] = React.useState(false);

      React.useEffect(() => {
        if (snapshot.notice === 'saved') {
          const timer = setTimeout(() => patch({ notice: null }), 1800);
          return () => clearTimeout(timer);
        }
        return undefined;
      }, [snapshot.notice]);

      if (status === null) {
        return h('div', { style: S.page }, h('div', { style: S.muted }, snapshot.error ?? t('checking')));
      }

      const config = status.config ?? {};
      const dismissing = config.dismissedVersion === status.target?.version;
      const showToastWorthy = status.updateAvailable && !dismissing;
      const headline = status.updateAvailable
        ? pill(status.ok ? 'warn' : 'fail', status.versionsBehind > 1 ? interpolate(t('updateAvailableCount'), { n: status.versionsBehind }) : t('updateAvailable'))
        : status.ok ? pill('ok', t('upToDate')) : pill('fail', t('checkFailed'));

      const probe = async () => {
        try {
          const result = await call('/proxy-probe', { cache: 'no-store' });
          setProbes(Array.isArray(result.candidates) ? result.candidates : []);
        } catch (error) {
          patch({ error: describeError(error) });
        }
      };

      const settingsCard = h('div', { key: 'settings', style: S.card }, [
        h('div', { key: 'h', style: S.h2 }, t('settingsTitle')),
        h('label', { key: 'enabled', style: { ...S.row, marginBottom: '6px' } }, [
          h('input', {
            key: 'i',
            type: 'checkbox',
            checked: config.enabled !== false,
            onChange: event => saveConfig({ enabled: event.target.checked }),
          }),
          h('span', { key: 'l' }, t('setEnabled')),
        ]),
        h('label', { key: 'notify', style: { ...S.row, marginBottom: '6px' } }, [
          h('input', {
            key: 'i',
            type: 'checkbox',
            checked: config.notify !== false,
            onChange: event => saveConfig({ notify: event.target.checked }),
          }),
          h('span', { key: 'l' }, t('setNotify')),
        ]),
        h('div', { key: 'interval', style: { ...S.row, margin: '8px 0' } }, [
          h('span', { key: 'l', style: { flex: '0 0 auto' } }, t('setInterval')),
          h('input', {
            key: 'i',
            type: 'number',
            min: 15,
            max: 10080,
            // Draft-then-commit: clamping on every keystroke would fight the typist.
            value: intervalDraft === null ? String(config.intervalMinutes ?? 360) : intervalDraft,
            style: { ...S.input, width: '110px' },
            onChange: event => setIntervalDraft(event.target.value),
            onBlur: () => {
              if (intervalDraft === null) return;
              const value = Number(intervalDraft);
              if (Number.isFinite(value) && value > 0) saveConfig({ intervalMinutes: value });
              setIntervalDraft(null);
            },
            onKeyDown: event => {
              if (event.key === 'Enter') event.target.blur();
            },
          }),
        ]),
        h('div', { key: 'mode', style: { ...S.row, margin: '8px 0' } }, [
          h('span', { key: 'l', style: { flex: '0 0 auto' } }, t('setChannel')),
          h('select', {
            key: 's',
            value: config.channelMode ?? 'follow',
            style: { ...S.input, width: '240px' },
            onChange: event => saveConfig({ channelMode: event.target.value }),
          }, [
            h('option', { key: 'f', value: 'follow' }, t('channelFollow')),
            h('option', { key: 'n', value: 'newest' }, t('channelNewest')),
          ]),
        ]),
        h('div', { key: 'proxy', style: { marginTop: '10px' } }, [
          h('div', { key: 'l', style: S.cellLabel }, t('setProxy')),
          h('div', { key: 'r', style: S.row }, [
            h('input', {
              key: 'i',
              type: 'text',
              placeholder: 'http://127.0.0.1:7890',
              value: proxyDraft === null ? (config.proxyUrl ?? '') : proxyDraft,
              style: { ...S.input, flex: '1 1 260px' },
              onChange: event => setProxyDraft(event.target.value),
              onKeyDown: event => {
                if (event.key === 'Enter') {
                  saveConfig({ proxyUrl: proxyDraft ?? '' });
                  setProxyDraft(null);
                }
              },
            }),
            h('button', {
              key: 'save',
              type: 'button',
              style: S.button,
              onClick: () => {
                saveConfig({ proxyUrl: proxyDraft ?? '' });
                setProxyDraft(null);
              },
            }, t('save')),
            h('button', { key: 'probe', type: 'button', style: S.button, onClick: probe }, t('proxyProbe')),
          ]),
          probes !== null
            ? h('div', { key: 'p', style: { ...S.muted, marginTop: '6px' } },
              probes.length === 0
                ? t('proxyProbeNone')
                : h('span', {}, [
                  `${t('proxyProbeFound')} `,
                  ...probes.map(candidate => h('button', {
                    key: candidate.url,
                    type: 'button',
                    style: { ...S.button, marginLeft: '6px' },
                    onClick: () => {
                      setProxyDraft(candidate.url);
                      saveConfig({ proxyUrl: candidate.url });
                      setProxyDraft(null);
                    },
                  }, `${candidate.url} · ${t('proxyProbeUse')}`)),
                ]))
            : null,
        ]),
        h('div', { key: 'base', style: { marginTop: '10px' } }, [
          h('div', { key: 'l', style: S.cellLabel }, t('setGithubBase')),
          h('div', { key: 'r', style: S.row }, [
            h('input', {
              key: 'i',
              type: 'text',
              value: baseDraft === null ? (config.githubApiBase ?? '') : baseDraft,
              style: { ...S.input, flex: '1 1 260px' },
              onChange: event => setBaseDraft(event.target.value),
              onKeyDown: event => {
                if (event.key === 'Enter') {
                  saveConfig({ githubApiBase: baseDraft ?? '' });
                  setBaseDraft(null);
                }
              },
            }),
            h('button', {
              key: 'save',
              type: 'button',
              style: S.button,
              onClick: () => {
                saveConfig({ githubApiBase: baseDraft ?? '' });
                setBaseDraft(null);
              },
            }, t('save')),
          ]),
        ]),
        snapshot.notice === 'saved' ? h('div', { key: 'notice', style: { ...S.muted, marginTop: '6px' } }, t('saved')) : null,
        snapshot.error ? h('div', { key: 'error', style: { ...S.muted, marginTop: '6px', color: 'var(--dsw-alias-state-error-primary)' } }, snapshot.error) : null,
      ]);

      return h('div', { style: S.page }, [
        h('div', { key: 'head' }, [
          h('div', { key: 'r1', style: S.titleRow }, [
            h('h1', { key: 'h', style: S.h1 }, t('title')),
            headline,
            h('button', {
              key: 'check',
              type: 'button',
              style: S.buttonPrimary,
              disabled: snapshot.busy === true,
              onClick: checkNow,
            }, snapshot.busy ? t('checking') : t('checkNow')),
          ]),
          h('div', { key: 'r2', style: { ...S.muted, marginTop: '4px' } },
            `${t('lastChecked')}: ${status.checkedAt ? formatTime(status.checkedAt) : t('neverChecked')} · ${t('vpnHint')}`),
          h('div', { key: 'r3', style: { ...S.muted, marginTop: '4px' } }, t('subtitle')),
        ]),

        h('div', { key: 'grid', style: S.grid }, [
          h('div', { key: 'cur', style: S.cell }, [
            h('div', { key: 'l', style: S.cellLabel }, t('current')),
            h('div', { key: 'v', style: S.cellValue }, status.current?.version ?? '—'),
            h('div', { key: 's', style: { ...S.muted, marginTop: '2px' } }, `${t('channel')}: ${status.current?.channel ?? '—'}`),
          ]),
          h('div', { key: 'tgt', style: S.cell }, [
            h('div', { key: 'l', style: S.cellLabel }, t('target')),
            h('div', { key: 'v', style: S.cellValue }, status.target?.version ?? '—'),
            h('div', { key: 's', style: { ...S.muted, marginTop: '2px' } }, `${t('published')}: ${formatTime(status.target?.publishedAt)}`),
          ]),
          h('div', { key: 'new', style: S.cell }, [
            h('div', { key: 'l', style: S.cellLabel }, 'npm dist-tags'),
            h('div', { key: 'v', style: { ...S.code, wordBreak: 'break-all' } },
              Object.entries(status.channels?.distTags ?? {}).map(([tag, version]) => `${tag}=${version}`).join('  ') || '—'),
          ]),
        ]),

        status.mode === 'follow' && status.newest?.version && status.newest.version !== status.target?.version
          ? h('div', { key: 'other', style: { ...S.muted } }, interpolate(t('otherChannel'), { v: status.newest.version }))
          : null,

        (() => {
          // Announce breakage before the command block, so it is read before the
          // line the user is about to paste into a terminal.
          const breaking = (status.notes ?? []).reduce((sum, entry) => sum + (entry.summary?.breaking ?? 0), 0);
          if (!status.updateAvailable || breaking === 0) return null;
          return h('div', {
            key: 'risk',
            style: {
              ...S.riskBanner,
              borderColor: 'var(--dsw-alias-state-error-primary)',
              background: 'color-mix(in srgb, var(--dsw-alias-state-error-primary) 9%, transparent)',
              color: 'var(--dsw-alias-state-error-primary)',
              fontWeight: 600,
            },
          }, ['⚠', h('span', { key: 't' }, interpolate(t('breakingBanner'), { n: breaking }))]);
        })(),

        Array.isArray(status.downgradeTags) && status.downgradeTags.length > 0
          ? h('div', { key: 'warn', style: S.warn }, [
            h('div', { key: 't', style: { fontWeight: 700, color: 'var(--dsw-alias-state-warn-primary)' } }, t('downgradeTitle')),
            h('div', { key: 'b', style: { marginTop: '4px' } }, interpolate(t('downgradeBody'), {
              tags: status.downgradeTags.map(entry => entry.tag).join(', '),
              v: status.downgradeTags[0].version,
              cur: status.current?.version ?? '—',
            })),
          ])
          : null,

        h('div', { key: 'cmd', style: S.card }, [
          h('div', { key: 'h', style: S.h2 }, t('commandTitle')),
          h('div', { key: 's', style: S.muted }, t('commandHint')),
          ...(status.selectors ?? []).map(row => h(CommandRow, {
            key: row.id,
            t,
            command: row.command,
            note: row.id === 'bare' ? t('bareWarning') : null,
            tone: row.id === 'bare' ? 'warn' : null,
          })),
        ]),

        h('div', { key: 'notes', style: S.card }, [
          h('div', { key: 'h', style: S.h2 }, t('notesTitle')),
          status.notesAvailable === false
            ? h('div', { key: 'u', style: S.muted }, t('notesUnavailable'))
            : null,
          (status.ignoredVersions ?? []).length > 0
            ? h('div', { key: 'ig', style: { ...S.row, marginTop: '6px' } }, [
              h('span', { key: 'l', style: S.muted }, interpolate(t('ignoredLine'), { n: status.ignoredVersions.length })),
              h('span', { key: 'v', style: { ...S.muted, ...S.code } }, status.ignoredVersions.join(', ')),
              h('button', { key: 'b', type: 'button', style: S.button, onClick: () => client.restoreIgnored() }, t('restoreAll')),
            ])
            : null,
          (status.notes ?? []).length === 0
            ? h('div', { key: 'e', style: S.muted }, t('notesEmpty'))
            : null,
          ...(status.notes ?? []).map(entry => h(NotesCard, {
            key: `n-${entry.version}`,
            t,
            entry,
            lang: snapshot.noteLang,
            onToggleLang: lang => patch({ noteLang: lang }),
            onlyRisk: snapshot.onlyRisk === true,
            onToggleRisk: value => patch({ onlyRisk: value }),
            onIgnore: version => client.setIgnored(version, true),
            compact: status.notesAvailable === false,
          })),
          status.currentRelease
            ? h('div', { key: 'cur', style: { marginTop: '10px' } }, [
              h('div', {
                key: 'sum',
                style: S.summary,
                onClick: () => setShowCurrentNotes(value => !value),
              }, `${showCurrentNotes ? '▼' : '▶'} ${t('notesCurrent')} (${status.currentRelease.version})`),
              showCurrentNotes
                ? h(NotesCard, {
                  key: 'card',
                  t,
                  entry: status.currentRelease,
                  lang: snapshot.noteLang,
                  onToggleLang: lang => patch({ noteLang: lang }),
                  onlyRisk: snapshot.onlyRisk === true,
                  onToggleRisk: value => patch({ onlyRisk: value }),
                })
                : null,
            ])
            : null,
        ]),

        h('div', { key: 'src', style: S.card }, [
          h('div', { key: 'h', style: S.h2 }, t('sourcesTitle')),
          h(SourceList, { key: 'l', t, status }),
        ]),

        settingsCard,

        h('div', { key: 'rt', style: S.card }, [
          h('div', { key: 'h', style: S.h2 }, t('runtimeTitle')),
          h('div', { key: 'g', style: S.grid }, [
            h('div', { key: 'n', style: S.cell }, [
              h('div', { key: 'l', style: S.cellLabel }, t('node')),
              h('div', { key: 'v', style: S.cellValue }, status.runtime?.node ?? '—'),
            ]),
            h('div', { key: 'p', style: S.cell }, [
              h('div', { key: 'l', style: S.cellLabel }, t('platform')),
              h('div', { key: 'v', style: S.cellValue }, status.runtime?.platform ?? '—'),
            ]),
            h('div', { key: 'd', style: S.cell }, [
              h('div', { key: 'l', style: S.cellLabel }, t('dshHome')),
              h('div', { key: 'v', style: { ...S.cellValue, fontSize: '11px' } }, status.runtime?.dshHome ?? '—'),
            ]),
            h('div', { key: 's', style: S.cell }, [
              h('div', { key: 'l', style: S.cellLabel }, t('detectedAt')),
              h('div', { key: 'v', style: { ...S.cellValue, fontSize: '11px' } }, status.current?.source ?? '—'),
            ]),
            // The page's own build is a local constant, so this cell is truthful
            // even while the Host is a generation behind; the sub-line appears
            // only once the Host confirms it heard this exact build.
            h('div', { key: 'c', style: S.cell }, [
              h('div', { key: 'l', style: S.cellLabel }, t('clientRev')),
              h('div', { key: 'v', style: S.cellValue }, CLIENT_REV),
              status.client?.rev === CLIENT_REV
                ? h('div', { key: 'a', style: { ...S.muted, marginTop: '2px' } }, formatTime(status.client.at))
                : null,
            ]),
          ]),
        ]),
      ]);
    }

    function Toast(props) {
      const { t } = props;
      const snapshot = useStore();
      const status = snapshot.status;
      const [hidden, setHidden] = React.useState(false);
      if (hidden || status === null || status.config?.notify === false) return null;
      if (!status.updateAvailable) return null;
      const target = status.target?.version;
      if (typeof target !== 'string' || target === '') return null;
      if (status.config?.dismissedVersion === target) return null;
      const exact = (status.selectors ?? []).find(row => row.id === 'exact');
      const command = exact?.command ?? `npm install -g @deepseek-ai/dsh@${target}`;
      const copy = async () => {
        try {
          await navigator.clipboard.writeText(command);
        } catch {
          /* clipboard unavailable */
        }
      };
      return h('div', { style: S.toast }, [
        h('div', { key: 't', style: { fontWeight: 700, marginBottom: '4px' } }, interpolate(t('newVersionToast'), { v: target })),
        h('div', { key: 'b', style: S.muted }, interpolate(t('toastBody'), { cur: status.current?.version ?? '—', v: target })),
        h('code', { key: 'c', style: { ...S.pre, marginTop: '8px' } }, command),
        h('div', { key: 'a', style: { ...S.row, marginTop: '9px', justifyContent: 'flex-end' } }, [
          h('button', { key: 'copy', type: 'button', style: S.buttonPrimary, onClick: copy }, t('copyCommand')),
          h('button', { key: 'hide', type: 'button', style: S.button, onClick: () => setHidden(true) }, t('cancel')),
          h('button', { key: 'dismiss', type: 'button', style: S.button, onClick: () => dismiss(target) }, t('dismiss')),
        ]),
      ]);
    }

    // ---------------------------------------------------------------------
    // plugin
    // ---------------------------------------------------------------------
    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, 'zh', ZH), 'dsh-update-lens: zh dictionary');
      ctx.effect(() => ctx.locale.register(NS, 'en', EN), 'dsh-update-lens: en dictionary');
      const t = ctx.locale.bind(NS);
      const client = { checkNow, saveConfig, dismiss, setIgnored, restoreIgnored };

      // The section re-registers when the badge flips: the ledger bump is what
      // makes the shell re-read the nav label.
      let disposeSection = null;
      const mountSection = () => {
        if (disposeSection !== null) {
          try {
            disposeSection();
          } catch {
            /* already gone */
          }
          disposeSection = null;
        }
        disposeSection = ctx.slots.register({
          name: 'settings.section',
          id: SECTION_ID,
          order: SECTION_ORDER,
          label: () => (badgeVersion === null ? t('nav') : t('navBadge')),
          locale: NS,
          inject: () => ({ t, client }),
        }, Section);
      };

      let slotReady = false;
      const stopInjection = ctx.slots.inject('settings.section', () => {
        slotReady = true;
        mountSection();
        return () => {
          slotReady = false;
          if (disposeSection !== null) {
            disposeSection();
            disposeSection = null;
          }
        };
      });
      ctx.effect(() => stopInjection, 'dsh-update-lens: settings section');

      onBadgeChanged = () => {
        if (slotReady) mountSection();
      };

      ctx.effect(() => {
        const stopOverlay = ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'update-center-toast',
          order: 30,
          label: () => t('nav'),
          locale: NS,
          inject: () => ({ t, client }),
        }, Toast));
        return stopOverlay;
      }, 'dsh-update-lens: notification overlay');

      ctx.effect(() => {
        loadStatus();
        const timer = setInterval(loadStatus, POLL_MS);
        return () => clearInterval(timer);
      }, 'dsh-update-lens: status polling');
    }

    return {
      name: 'dsh-update-lens',
      apply,
      inject: ['slots', 'locale'],
    };
  },
});
