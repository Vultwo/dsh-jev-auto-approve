window.__ModuleLoader__.load({
  id: 'dsh-jev-auto-approve',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const NS = 'jevAutoApprove';
    const CREDENTIAL_REF = 'TYPESAFE_API_KEY';

    const en = {
      summary: 'Review approval requests with TypeSafe Jev and auto-approve low-risk actions.',
      title: 'TypeSafe Jev key',
      description: 'The key is stored in the DSH credential store, not in the profile file. It is used for every approval review and for the connection test.',
      apiKey: 'API key',
      apiKeyPlaceholder: 'Paste your TypeSafe key',
      apiKeyHint: 'Saving a new key replaces the stored one immediately. The key is never shown again.',
      configured: 'Configured',
      notConfigured: 'Not configured',
      save: 'Save key',
      saving: 'Saving...',
      clear: 'Clear key',
      clearing: 'Clearing...',
      test: 'Test connection',
      testing: 'Testing...',
      saved: 'The key was saved.',
      cleared: 'The stored key was cleared.',
      keyRequired: 'Enter a TypeSafe key first.',
      saveFailed: 'The key could not be saved.',
      clearFailed: 'The key could not be cleared.',
      testOk: 'Connection OK',
      testFailed: 'Connection failed',
      stats: 'Usage',
      sinceStart: 'Since this app started',
      calls: 'Reviews',
      autoApproved: 'Auto-approved',
      asked: 'Asked a human',
      inputTokens: 'Input tokens',
      outputTokens: 'Output tokens',
      cost: 'Estimated cost',
      last: 'Last review',
      none: 'None',
      statsHint: 'Counts include every review this plugin performed after the app started. Token and cost figures come from the Jev response.',
      keyStatusUnavailable: 'Could not read the stored key status.',
      clearConfirm: 'Remove the stored TypeSafe key?',
    };

    const button = {
      height: '32px',
      padding: '0 12px',
      borderRadius: '6px',
      border: '1px solid var(--dsw-alias-border-l1)',
      background: 'var(--dsw-alias-bg-layer-2)',
      color: 'var(--dsw-alias-label-primary)',
      cursor: 'pointer',
      font: 'inherit',
      fontSize: '12px',
    };
    const styles = {
      page: { display: 'grid', gap: '16px' },
      card: {
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '10px',
        padding: '16px',
        background: 'var(--dsw-alias-bg-layer-1)',
        display: 'grid',
        gap: '10px',
      },
      header: { display: 'flex', alignItems: 'baseline', gap: '8px', justifyContent: 'space-between', flexWrap: 'wrap' },
      title: { fontSize: '14px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)' },
      hint: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', lineHeight: 1.5 },
      row: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' },
      input: {
        flex: '1 1 260px',
        minWidth: '220px',
        height: '32px',
        padding: '0 10px',
        borderRadius: '6px',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
        font: 'inherit',
      },
      button,
      buttonPrimary: {
        ...button,
        background: 'var(--dsw-alias-brand-primary)',
        borderColor: 'var(--dsw-alias-brand-primary)',
        color: '#fff',
      },
      badge: { display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' },
      dot: (configured) => ({
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        background: configured ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-idle-primary)',
      }),
      stats: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '8px' },
      stat: {
        border: '1px solid var(--dsw-alias-border-l1)',
        borderRadius: '8px',
        padding: '10px',
        background: 'var(--dsw-alias-bg-layer-2)',
      },
      statValue: { fontSize: '18px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)' },
      statLabel: { fontSize: '11px', color: 'var(--dsw-alias-label-secondary)', marginTop: '2px' },
      error: { color: 'var(--dsw-alias-state-error-primary)', fontSize: '12px', whiteSpace: 'pre-wrap' },
      notice: { color: 'var(--dsw-alias-state-success-primary)', fontSize: '12px' },
      last: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', wordBreak: 'break-word' },
    };

    function FormPage(props) {
      const { t } = props;
      const [key, setKey] = React.useState('');
      const [credential, setCredential] = React.useState(null);
      const [stats, setStats] = React.useState(null);
      const [busy, setBusy] = React.useState('');
      const [notice, setNotice] = React.useState('');
      const [error, setError] = React.useState('');

      const loadCredential = async () => {
        try {
          const response = await props.readCredential();
          if (response !== undefined && response.ok) {
            const info = response.value?.[CREDENTIAL_REF];
            setCredential(info ?? { configured: false, writable: true });
          } else {
            setCredential({ configured: false, writable: true });
            setError(response?.error?.message ?? t('keyStatusUnavailable'));
          }
        } catch (err) {
          setCredential({ configured: false, writable: true });
          setError(err instanceof Error ? err.message : String(err));
        }
      };
      const loadStats = async () => {
        try {
          setStats(await props.loadStats());
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
      };

      React.useEffect(() => {
        let alive = true;
        void (async () => {
          await loadCredential();
          if (alive) await loadStats();
        })();
        const timer = setInterval(() => {
          if (alive) void loadStats();
        }, 5000);
        return () => {
          alive = false;
          clearInterval(timer);
        };
      }, []);

      const configured = credential?.configured === true;
      const save = async () => {
        if (key.trim().length === 0) {
          setNotice('');
          setError(t('keyRequired'));
          return;
        }
        setBusy('save');
        setError('');
        setNotice('');
        try {
          const response = await props.saveKey(key.trim());
          if (response !== undefined && response.ok) {
            setKey('');
            setNotice(t('saved'));
            await loadCredential();
            await loadStats();
          } else {
            setError(response?.error?.message ?? t('saveFailed'));
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy('');
        }
      };
      const clear = async () => {
        if (!window.confirm(t('clearConfirm'))) return;
        setBusy('clear');
        setError('');
        setNotice('');
        try {
          const response = await props.clearKey();
          if (response !== undefined && response.ok) {
            setNotice(t('cleared'));
            await loadCredential();
            await loadStats();
          } else {
            setError(response?.error?.message ?? t('clearFailed'));
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        } finally {
          setBusy('');
        }
      };
      const test = async () => {
        setBusy('test');
        setError('');
        setNotice('');
        try {
          const result = await props.testConnection();
          if (result?.ok) {
            setNotice(`${t('testOk')} - ${result.model ?? ''} ${result.latencyMs ?? ''} ms`.trim());
          } else {
            setError(`${t('testFailed')}: ${result?.error ?? 'unknown'}`);
          }
          await loadStats();
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
        setBusy('');
      };

      const values = [
        [t('calls'), stats?.reviews ?? 0],
        [t('autoApproved'), stats?.allowed ?? 0],
        [t('asked'), stats?.asked ?? 0],
        [t('inputTokens'), (stats?.inputTokens ?? 0).toLocaleString()],
        [t('outputTokens'), (stats?.outputTokens ?? 0).toLocaleString()],
        [t('cost'), `$${(stats?.costUsd ?? 0).toFixed(6)}`],
      ];
      const lastText =
        stats?.last === null || stats?.last === undefined
          ? t('none')
          : `${stats.last.outcome} - ${stats.last.tool}${stats.last.reason ? ` (${stats.last.reason})` : ''}`;

      return h(
        'div',
        { style: styles.page },
        h(
          'section',
          { style: styles.card },
          h(
            'div',
            { style: styles.header },
            h('div', { style: styles.title }, t('title')),
            h(
              'div',
              { style: styles.badge },
              h('span', { style: styles.dot(configured), 'aria-hidden': true }),
              configured ? t('configured') : t('notConfigured'),
            ),
          ),
          h('div', { style: styles.hint }, t('description')),
          h('label', { style: styles.hint, htmlFor: 'jev-auto-key' }, t('apiKey')),
          h(
            'div',
            { style: styles.row },
            h('input', {
              id: 'jev-auto-key',
              type: 'password',
              autoComplete: 'off',
              spellCheck: false,
              placeholder: t('apiKeyPlaceholder'),
              value: key,
              onChange: (event) => setKey(event.target.value),
              style: styles.input,
            }),
            h(
              'button',
              { type: 'button', style: styles.buttonPrimary, disabled: busy !== '', onClick: save },
              busy === 'save' ? t('saving') : t('save'),
            ),
            h(
              'button',
              { type: 'button', style: styles.button, disabled: busy !== '' || !configured, onClick: clear },
              busy === 'clear' ? t('clearing') : t('clear'),
            ),
            h(
              'button',
              { type: 'button', style: styles.button, disabled: busy !== '' || !configured, onClick: test },
              busy === 'test' ? t('testing') : t('test'),
            ),
          ),
          h('div', { style: styles.hint }, t('apiKeyHint')),
          notice ? h('div', { style: styles.notice }, notice) : null,
          error ? h('div', { style: styles.error }, error) : null,
        ),
        h(
          'section',
          { style: styles.card },
          h(
            'div',
            { style: styles.header },
            h('div', { style: styles.title }, t('stats')),
            h('div', { style: styles.hint }, t('sinceStart')),
          ),
          h(
            'div',
            { style: styles.stats },
            values.map(([label, value]) =>
              h(
                'div',
                { key: label, style: styles.stat },
                h('div', { style: styles.statValue }, String(value)),
                h('div', { style: styles.statLabel }, label),
              ),
            ),
          ),
          h('div', { style: styles.last }, `${t('last')}: ${lastText}`),
          h('div', { style: styles.hint }, t('statsHint')),
        ),
      );
    }

    function Page(props) {
      return props.view === 'summary' ? props.t('summary') : h(FormPage, props);
    }

    return {
      inject: ['slots', 'locale', 'remote', 'remote.credentials'],
      apply(ctx) {
        const t = ctx.locale.bind(NS);
        ctx.effect(() => ctx.locale.register(NS, { en }), 'jev-auto-approve: dictionaries');
        ctx.slots.inject('plugins.row.config', () =>
          ctx.slots.register(
            {
              name: 'plugins.row.config',
              key: 'dsh-jev-auto-approve#jev-auto-approve',
              locale: NS,
              inject: () => ({
                readCredential: () => ctx.remote.credentials.describe([CREDENTIAL_REF]),
                saveKey: (value) => ctx.remote.credentials.set(CREDENTIAL_REF, value),
                clearKey: () => ctx.remote.credentials.unset(CREDENTIAL_REF),
                testConnection: async () => {
                  const response = await fetch('/jev-auto/test', {
                    method: 'POST',
                    headers: { 'x-jev-auto': 'test' },
                  });
                  if (!response.ok) throw new Error(`HTTP ${response.status}`);
                  return await response.json();
                },
                loadStats: async () => {
                  const response = await fetch('/jev-auto/stats', {
                    headers: { accept: 'application/json' },
                  });
                  if (!response.ok) throw new Error(`HTTP ${response.status}`);
                  return await response.json();
                },
              }),
            },
            Page,
          ),
        );
      },
    };
  },
});
