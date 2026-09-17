import {
  icon,
  navigation,
  renderAudit as renderBaseAudit,
  renderDeliveries as renderBaseDeliveries,
  renderIntegrations as renderBaseIntegrations,
  renderNavigation,
  renderOverview as renderBaseOverview,
  renderReviews as renderBaseReviews,
} from './components.js';
import {
  escapeHtml,
  formatDateTime,
  formatNumber,
  formatRelativeTime,
  getJobTitle,
  progressPercent,
  shortId,
  statusMeta,
} from './state.js';
import { filterJobs, filterResults } from './dashboard-utils.js';

export { navigation, renderNavigation };

function badge(label, tone = 'muted') {
  return `<span class="badge badge--${escapeHtml(tone)}">${escapeHtml(label)}</span>`;
}

function statusBadge(status) {
  const meta = statusMeta(status);
  return badge(meta.label, meta.tone);
}

function stateBanner(state, key, emptyLabel = '') {
  const status = state.dataStates?.[key] || 'idle';
  const error = state.errors?.[key];
  if (error) {
    return `<div class="data-banner data-banner--danger" role="alert">${icon('warning', 18)}<div><strong>Unable to load ${escapeHtml(emptyLabel || key)}</strong><span>${escapeHtml(error)}</span></div></div>`;
  }
  if (status === 'loading') {
    return `<div class="data-banner" role="status">${icon('refresh', 18)}<div><strong>Loading ${escapeHtml(emptyLabel || key)}</strong><span>The current view will update when the request completes.</span></div></div>`;
  }
  return '';
}

function replaceOverviewControls(markup, state) {
  const ranges = [
    ['12h', '12 hours'],
    ['24h', '24 hours'],
    ['7d', '7 days'],
  ];
  const controls = `<div class="segmented-control" aria-label="Throughput range">${ranges
    .map(
      ([value, label]) =>
        `<button class="${state.throughputRange === value ? 'is-active' : ''}" type="button" data-throughput-range="${value}" aria-pressed="${state.throughputRange === value}">${label}</button>`,
    )
    .join('')}</div>`;
  const axisLabel =
    state.throughputRange === '7d'
      ? '7 days ago'
      : state.throughputRange === '24h'
        ? '24 hours ago'
        : '12 hours ago';
  return markup
    .replace(
      /<div class="segmented-control" aria-label="Throughput range">[\s\S]*?<\/div>/,
      controls,
    )
    .replace(
      '<div class="chart-axis"><span>12 hours ago</span><span>Now</span></div>',
      `<div class="chart-axis"><span>${axisLabel}</span><span>Now</span></div>`,
    );
}

export function renderOverview(state) {
  const banner = stateBanner(state, 'dashboard', 'dashboard data');
  const markup = replaceOverviewControls(renderBaseOverview(state), state);
  return markup.replace(/(<section class="view-stack"[^>]*>)/, `$1${banner}`);
}

function jobFilterOptions(selected) {
  return [
    ['', 'All statuses'],
    ['queued', 'Queued'],
    ['running', 'Running'],
    ['completed', 'Completed'],
    ['failed', 'Failed'],
    ['cancel_requested', 'Cancelling'],
    ['cancelled', 'Cancelled'],
  ]
    .map(
      ([value, label]) =>
        `<option value="${value}"${selected === value ? ' selected' : ''}>${label}</option>`,
    )
    .join('');
}

function jobSortOptions(selected) {
  return [
    ['updated-desc', 'Recently updated'],
    ['created-desc', 'Newest created'],
    ['created-asc', 'Oldest created'],
    ['status', 'Status'],
  ]
    .map(
      ([value, label]) =>
        `<option value="${value}"${selected === value ? ' selected' : ''}>${label}</option>`,
    )
    .join('');
}

function jobRows(jobs) {
  return jobs
    .map((job) => {
      const percent = progressPercent(job);
      const companies = job.progress?.companiesResolved ?? job.progress?.companies_resolved ?? 0;
      return `<tr data-job-row="${escapeHtml(job.id)}">
        <td><button class="job-link" type="button" data-open-job="${escapeHtml(job.id)}"><span class="job-link__title">${escapeHtml(getJobTitle(job))}</span><span class="job-link__id">${escapeHtml(shortId(job.id))}</span></button></td>
        <td>${statusBadge(job.status)}</td>
        <td><div class="progress-cell"><div class="progress-track"><span style="--progress:${percent}%"></span></div><small>${percent}%</small></div></td>
        <td>${escapeHtml(formatNumber(companies))}</td>
        <td><time datetime="${escapeHtml(job.updated_at)}">${escapeHtml(formatRelativeTime(job.updated_at))}</time></td>
        <td><button class="icon-button icon-button--quiet" type="button" data-open-job="${escapeHtml(job.id)}" aria-label="Open ${escapeHtml(getJobTitle(job))}">${icon('chevron', 18)}</button></td>
      </tr>`;
    })
    .join('');
}

export function renderJobs(state) {
  const jobs = filterJobs(state.jobs, state.jobFilters);
  const filtersActive = Boolean(
    state.jobFilters.search || state.jobFilters.status || state.jobFilters.sort !== 'updated-desc',
  );
  return `<section class="view-stack" aria-labelledby="jobs-heading">
    <div class="page-heading"><div><p class="eyebrow">Workload manager</p><h1 id="jobs-heading">Crawl jobs</h1><p>Search, filter, sort, inspect, cancel, and retry tenant-scoped workloads.</p></div><a class="button button--primary" href="#/new-crawl">${icon('plus', 17)} New crawl</a></div>
    ${stateBanner(state, 'jobs', 'jobs')}
    <div class="toolbar toolbar--wrap">
      <label class="search-field"><span class="sr-only">Search jobs</span>${icon('search', 17)}<input type="search" placeholder="Search seed URL, job or correlation ID" value="${escapeHtml(state.jobFilters.search)}" data-job-search /></label>
      <label class="select-field"><span class="sr-only">Filter by status</span><select data-job-status>${jobFilterOptions(state.jobFilters.status)}</select></label>
      <label class="select-field"><span class="sr-only">Sort jobs</span><select data-job-sort>${jobSortOptions(state.jobFilters.sort)}</select></label>
      <button class="button button--secondary" type="button" data-clear-job-filters${filtersActive ? '' : ' disabled'}>Clear filters</button>
      <button class="button button--secondary" type="button" data-refresh>${icon('refresh', 17)} Refresh</button>
    </div>
    <article class="panel panel--table">
      <div class="panel__header panel__header--compact"><div><h2>${jobs.length} matching jobs</h2><p class="panel__description">${state.jobs.length} loaded in this browser session. The API remains authoritative.</p></div>${state.nextJobCursor ? '<button class="text-link" type="button" data-load-more-jobs>Load more</button>' : ''}</div>
      ${jobs.length ? `<div class="table-shell"><table class="data-table"><thead><tr><th>Job</th><th>Status</th><th>Progress</th><th>Companies</th><th>Updated</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${jobRows(jobs)}</tbody></table></div>` : `<div class="empty-state">${icon('search', 28)}<strong>No matching jobs</strong><span>${filtersActive ? 'Clear or adjust the current filters.' : 'Create a bounded crawl or refresh the API connection.'}</span></div>`}
    </article>
  </section>`;
}

function importPreview(preview) {
  if (!preview)
    return '<div class="import-empty"><strong>No file selected</strong><span>CSV headers may use website, url, seed_url, domain, or homepage. JSON may contain an array or companies/targets/records/items.</span></div>';
  const invalid = preview.invalid || [];
  return `<div class="import-preview" role="status">
    <div class="import-preview__summary"><div><strong>${escapeHtml(preview.fileName || 'Imported file')}</strong><span>${preview.urls.length} valid websites · ${preview.duplicates} duplicates · ${invalid.length} invalid rows</span></div>${badge(invalid.length ? 'Review needed' : 'Ready', invalid.length ? 'warning' : 'success')}</div>
    <ol>${preview.urls
      .slice(0, 5)
      .map((url) => `<li>${icon('globe', 14)}<span>${escapeHtml(url)}</span></li>`)
      .join('')}</ol>
    ${preview.urls.length > 5 ? `<small>Plus ${preview.urls.length - 5} more valid websites.</small>` : ''}
    ${
      invalid.length
        ? `<details><summary>Show invalid rows</summary><ul>${invalid
            .slice(0, 20)
            .map((item) => `<li>Row ${escapeHtml(item.row)}: ${escapeHtml(item.error)}</li>`)
            .join('')}</ul></details>`
        : ''
    }
    <div class="inline-actions"><button class="button button--secondary" type="button" data-apply-import>Apply to target list</button><button class="text-link" type="button" data-clear-import>Clear import</button></div>
  </div>`;
}

export function renderNewCrawl(state) {
  const locked = !state.writeControlsEnabled && !state.demoMode;
  const busy = state.dataStates?.command === 'loading';
  const maxCompanies = Math.min(500, Number(state.capabilities?.max_companies_per_job || 500));
  const maxPages = Number(state.capabilities?.max_pages_per_job || 50_000);
  return `<section class="view-stack" aria-labelledby="new-crawl-heading">
    <div class="page-heading"><div><p class="eyebrow">Bounded command</p><h1 id="new-crawl-heading">Create a crawl job</h1><p>Import up to ${maxCompanies} companies, validate every field, and submit only through the documented job API.</p></div>${badge(state.demoMode ? 'Demo simulation' : locked ? 'Writes locked' : 'Writes enabled', state.demoMode ? 'neutral' : locked ? 'muted' : 'warning')}</div>
    ${stateBanner(state, 'command', 'crawl command')}
    <div class="form-layout">
      <form class="panel form-panel" data-crawl-form novalidate>
        <div class="form-section"><div class="form-section__heading"><span>01</span><div><h2>CSV or JSON import</h2><p>Parse and preview locally. Nothing is uploaded until the crawl form is submitted.</p></div></div>
          <label class="import-dropzone" data-import-dropzone><input type="file" accept=".csv,.json,text/csv,application/json" data-import-file /><span>${icon('download', 22)}</span><strong>Choose or drop a CSV/JSON file</strong><small>Maximum ${maxCompanies} unique websites.</small></label>
          ${importPreview(state.importPreview)}
        </div>
        <div class="form-section"><div class="form-section__heading"><span>02</span><div><h2>Targets</h2><p>One public HTTP or HTTPS URL per line. Imported websites can be merged here.</p></div></div>
          <label class="field field--full"><span>Seed URLs</span><textarea name="seedUrls" rows="8" placeholder="https://company-one.example/&#10;https://company-two.example/" required>${escapeHtml(state.draftSeedUrls || '')}</textarea><small>At most ${maxCompanies} unique websites. Private-network destinations are rejected server-side.</small></label>
        </div>
        <div class="form-section"><div class="form-section__heading"><span>03</span><div><h2>Extraction profile</h2><p>Unavailable provider modes are disabled from capability evidence.</p></div></div>
          <div class="field-grid">
            <label class="field"><span>Profile</span><select name="profile"><option value="full">Full business profile</option><option value="company">Company details</option><option value="contacts">Contacts only</option><option value="registry"${state.capabilities?.registry_enrichment ? '' : ' disabled'}>Registry enrichment${state.capabilities?.registry_enrichment ? '' : ' — unavailable'}</option></select></label>
            <label class="field"><span>Browser strategy</span><select name="browser"><option value="auto">Automatic fallback</option><option value="http">HTTP only</option><option value="playwright">Browser required</option></select></label>
            <label class="field"><span>Country</span><input name="countryCode" value="US" maxlength="2" pattern="[A-Za-z]{2}" /></label>
            <label class="field"><span>Mode</span><select name="mode"><option value="domain">Domain crawl</option><option value="single">Single page</option><option value="list">Explicit list</option><option value="discovery"${state.capabilities?.discovery ? '' : ' disabled'}>Search discovery${state.capabilities?.discovery ? '' : ' — unavailable'}</option></select></label>
          </div>
        </div>
        <div class="form-section"><div class="form-section__heading"><span>04</span><div><h2>Safety limits</h2><p>Dashboard limits never exceed the capability response or 500 companies.</p></div></div>
          <div class="field-grid field-grid--three">
            <label class="field"><span>Max pages</span><input type="number" name="maxPages" value="250" min="1" max="${maxPages}" required /></label>
            <label class="field"><span>Max companies</span><input type="number" name="maxCompanies" value="${maxCompanies}" min="1" max="${maxCompanies}" required /></label>
            <label class="field"><span>Max depth</span><input type="number" name="maxDepth" value="3" min="0" max="8" required /></label>
            <label class="field"><span>Requests / second</span><input type="number" name="requestsPerSecond" value="1" min="0.1" max="10" step="0.1" required /></label>
            <label class="field field--span-two"><span>Callback reference <em>optional</em></span><input name="callbackReference" maxlength="200" placeholder="CRM campaign or case reference" /></label>
          </div>
        </div>
        <div class="form-section"><div class="form-section__heading"><span>05</span><div><h2>URL policy and tags</h2><p>These fields map directly to the documented request contract.</p></div></div>
          <div class="field-grid">
            <label class="field"><span>Include patterns <em>optional</em></span><textarea name="includePatterns" rows="4" placeholder="/contact&#10;/about"></textarea><small>One value per line, up to 50.</small></label>
            <label class="field"><span>Exclude patterns <em>optional</em></span><textarea name="excludePatterns" rows="4" placeholder="/careers&#10;/privacy"></textarea><small>One value per line, up to 50.</small></label>
            <label class="field field--full"><span>Tags <em>optional</em></span><textarea name="tags" rows="3" placeholder="campaign=Q3-outreach&#10;source=operator-import"></textarea><small>One key=value pair per line.</small></label>
          </div>
        </div>
        <div class="form-error" data-form-error tabindex="-1" hidden></div>
        <div class="form-actions"><button class="button button--secondary" type="reset" data-reset-crawl>Reset</button><button class="button button--primary" type="submit"${locked || busy ? ' disabled' : ''}>${icon('bolt', 17)} ${busy ? 'Submitting…' : state.demoMode ? 'Simulate crawl' : 'Create crawl job'}</button></div>
      </form>
      <aside class="panel form-aside"><div class="form-aside__icon">${icon('shield', 24)}</div><h2>Command safety</h2><ul class="check-list"><li>${icon('check', 15)} CSV/JSON parsed in the browser</li><li>${icon('check', 15)} Duplicate websites removed</li><li>${icon('check', 15)} Idempotency and correlation IDs generated</li><li>${icon('check', 15)} Tenant authority comes from authentication</li><li>${icon('check', 15)} Provider modes remain capability-gated</li></ul><div class="aside-note"><strong>Sensitive identifiers</strong><span>The dashboard does not accept raw EIN values in this general crawl form.</span></div></aside>
    </div>
  </section>`;
}

function resultRows(items) {
  return items
    .map((item) => {
      const record = item.record || {};
      const confidence = Math.round(Number(record.confidence || 0) * 100);
      const categories = record.categories || [];
      const emails = record.emails || [];
      const phones = record.phones || [];
      return `<tr><td><button class="job-link" type="button" data-open-result="${escapeHtml(item.id)}"><span class="job-link__title">${escapeHtml(record.displayName || record.legalName || 'Unnamed business')}</span><span class="job-link__id">${escapeHtml(record.domain || shortId(item.id))}</span></button></td><td><div class="confidence"><span style="--confidence:${confidence}%"></span><strong>${confidence}%</strong></div></td><td>${
        categories.length
          ? categories
              .slice(0, 3)
              .map((value) => badge(value, 'neutral'))
              .join(' ')
          : '<span class="muted">Unclassified</span>'
      }</td><td>${escapeHtml(emails[0] || phones[0] || 'No contact')}</td><td><time datetime="${escapeHtml(record.lastSeenAt || '')}">${escapeHtml(formatRelativeTime(record.lastSeenAt))}</time></td><td><button class="icon-button icon-button--quiet" type="button" data-open-result="${escapeHtml(item.id)}" aria-label="Open ${escapeHtml(record.displayName || record.domain || 'result')}">${icon('chevron', 18)}</button></td></tr>`;
    })
    .join('');
}

function confidenceOptions(selected) {
  return [
    [0, 'All confidence'],
    [0.5, '50% and higher'],
    [0.7, '70% and higher'],
    [0.85, '85% and higher'],
    [0.95, '95% and higher'],
  ]
    .map(
      ([value, label]) =>
        `<option value="${value}"${Number(selected) === value ? ' selected' : ''}>${label}</option>`,
    )
    .join('');
}

export function renderResults(state) {
  const selectedJob =
    state.selectedResultJobId || state.jobs.find((job) => job.status === 'completed')?.id || '';
  const resultJob = state.jobs.find((job) => job.id === selectedJob);
  const visible = filterResults(state.results, state.resultFilters);
  const filtersActive = Boolean(
    state.resultFilters.search ||
    Number(state.resultFilters.minConfidence) > 0 ||
    state.resultFilters.contact !== 'any',
  );
  return `<section class="view-stack" aria-labelledby="results-heading">
    <div class="page-heading"><div><p class="eyebrow">Resolved entities</p><h1 id="results-heading">Business results</h1><p>Search and filter the currently loaded result page, inspect evidence, and export only the visible view.</p></div><div class="page-heading__actions"><button class="button button--secondary" type="button" data-export-results="csv"${visible.length ? '' : ' disabled'}>${icon('download', 17)} CSV</button><button class="button button--secondary" type="button" data-export-results="json"${visible.length ? '' : ' disabled'}>${icon('download', 17)} JSON</button></div></div>
    ${stateBanner(state, 'results', 'results')}
    <div class="toolbar toolbar--wrap">
      <label class="select-field select-field--wide"><span class="sr-only">Select completed job</span><select data-result-job>${state.jobs
        .filter((job) => job.status === 'completed' || job.id === selectedJob)
        .map(
          (job) =>
            `<option value="${escapeHtml(job.id)}"${job.id === selectedJob ? ' selected' : ''}>${escapeHtml(getJobTitle(job))} · ${escapeHtml(shortId(job.id))}</option>`,
        )
        .join('')}</select></label>
      <label class="search-field"><span class="sr-only">Search results</span>${icon('search', 17)}<input type="search" placeholder="Search business, domain or contact" value="${escapeHtml(state.resultFilters.search)}" data-result-search /></label>
      <label class="select-field"><span class="sr-only">Minimum confidence</span><select data-result-confidence>${confidenceOptions(state.resultFilters.minConfidence)}</select></label>
      <label class="select-field"><span class="sr-only">Contact filter</span><select data-result-contact><option value="any"${state.resultFilters.contact === 'any' ? ' selected' : ''}>Any contact state</option><option value="email"${state.resultFilters.contact === 'email' ? ' selected' : ''}>Has email</option><option value="phone"${state.resultFilters.contact === 'phone' ? ' selected' : ''}>Has phone</option><option value="missing"${state.resultFilters.contact === 'missing' ? ' selected' : ''}>No email or phone</option></select></label>
      <button class="button button--secondary" type="button" data-clear-result-filters${filtersActive ? '' : ' disabled'}>Clear filters</button><button class="button button--secondary" type="button" data-refresh-results${selectedJob ? '' : ' disabled'}>${icon('refresh', 17)} Refresh results</button>
    </div>
    <article class="panel panel--table"><div class="panel__header"><div><h2>${escapeHtml(resultJob ? getJobTitle(resultJob) : 'Select a completed job')}</h2><p class="panel__description">${visible.length} visible of ${state.results.length} loaded records. Confidence is evidence-derived, not a registry claim.</p></div>${resultJob ? statusBadge(resultJob.status) : badge('No job selected', 'muted')}</div>
      ${visible.length ? `<div class="table-shell"><table class="data-table data-table--results"><thead><tr><th>Business</th><th>Confidence</th><th>Categories</th><th>Primary contact</th><th>Last seen</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${resultRows(visible)}</tbody></table></div>` : `<div class="empty-state">${icon('results', 28)}<strong>${filtersActive ? 'No matching results' : 'No records loaded'}</strong><span>${filtersActive ? 'Clear or adjust the result filters.' : 'Choose a completed job and refresh results.'}</span></div>`}
      ${state.nextResultCursor ? '<div class="panel__footer"><button class="button button--secondary" type="button" data-load-more-results>Load more results</button></div>' : ''}
    </article>
  </section>`;
}

function diagnosticCards(state) {
  const diagnostics = state.diagnostics || [];
  if (!diagnostics.length)
    return '<div class="empty-state empty-state--compact"><strong>No diagnostic run yet</strong><span>Read-only checks never create, cancel, or retry jobs.</span></div>';
  return `<div class="diagnostic-grid">${diagnostics.map((item) => `<article class="diagnostic-card"><div><strong>${escapeHtml(item.label)}</strong>${badge(item.status, item.status === 'pass' ? 'success' : item.status === 'skipped' ? 'muted' : 'danger')}</div><span>${escapeHtml(item.detail || '')}</span><small>${item.durationMs == null ? 'Not requested' : `${escapeHtml(item.durationMs)} ms`}</small></article>`).join('')}</div>`;
}

export function renderIntegrations(state) {
  const base = renderBaseIntegrations(state);
  const panel = `<article class="panel diagnostics-panel"><div class="panel__header"><div><p class="eyebrow">Read-only API validation</p><h2>Documented endpoint checks</h2><p class="panel__description">Service info, health, readiness, OpenAPI, capabilities, stats, metrics, jobs, and selected-job results are checked without mutating state.</p></div><button class="button button--secondary" type="button" data-run-diagnostics${state.dataStates?.diagnostics === 'loading' ? ' disabled' : ''}>${icon('refresh', 17)} ${state.dataStates?.diagnostics === 'loading' ? 'Checking…' : 'Run read-only checks'}</button></div>${stateBanner(state, 'diagnostics', 'API diagnostics')}${diagnosticCards(state)}<div class="contract-note"><strong>Mutation aliases are not auto-probed</strong><span>POST /api/v2/jobs, /commands/crawl, cancellation, and retry endpoints are exercised only through explicit operator actions with confirmation, correlation, and idempotency headers.</span></div></article>`;
  const position = base.lastIndexOf('</section>');
  return position < 0
    ? `${base}${panel}`
    : `${base.slice(0, position)}${panel}${base.slice(position)}`;
}

export const renderReviews = renderBaseReviews;
export const renderDeliveries = renderBaseDeliveries;
export const renderAudit = renderBaseAudit;

function progressValue(progress, camel, snake) {
  return progress?.[camel] ?? progress?.[snake] ?? 0;
}

function renderJobDrawer(job, state) {
  if (!job)
    return '<div class="drawer__body"><div class="empty-state"><strong>Job is unavailable</strong><span>Refresh the job list and try again.</span></div></div>';
  const percent = progressPercent(job);
  const canCancel = ['queued', 'running'].includes(job.status);
  const canRetry = ['failed', 'cancelled'].includes(job.status);
  const locked = !state.writeControlsEnabled && !state.demoMode;
  const pending = Boolean(state.pendingActions?.[job.id]);
  const payload = job.payload || {};
  const seeds = payload.seedUrls || payload.seed_urls || [];
  return `<div class="drawer__header"><div><p class="eyebrow">Job ${escapeHtml(shortId(job.id))}</p><h2>${escapeHtml(getJobTitle(job))}</h2></div><button class="icon-button" type="button" data-close-drawer aria-label="Close job details">${icon('close', 20)}</button></div>
    <div class="drawer__body">${stateBanner(state, 'drawer', 'job details')}<div class="drawer-status"><div>${statusBadge(job.status)}<span>Version ${escapeHtml(job.version)}</span></div><strong>${percent}%</strong></div><div class="progress-track progress-track--large"><span style="--progress:${percent}%"></span></div>
      <dl class="detail-list"><div><dt>Job ID</dt><dd><code>${escapeHtml(job.id)}</code><button class="copy-button" type="button" data-copy="${escapeHtml(job.id)}" aria-label="Copy job ID">${icon('copy', 15)}</button></dd></div><div><dt>Correlation</dt><dd><code>${escapeHtml(job.correlation_id || 'Not provided')}</code>${job.correlation_id ? `<button class="copy-button" type="button" data-copy="${escapeHtml(job.correlation_id)}" aria-label="Copy correlation ID">${icon('copy', 15)}</button>` : ''}</dd></div><div><dt>Created</dt><dd>${escapeHtml(formatDateTime(job.created_at))}</dd></div><div><dt>Started</dt><dd>${escapeHtml(formatDateTime(job.started_at))}</dd></div><div><dt>Completed</dt><dd>${escapeHtml(formatDateTime(job.completed_at))}</dd></div><div><dt>Browser</dt><dd>${escapeHtml(payload.browser || 'Not returned')}</dd></div><div><dt>Profile</dt><dd>${escapeHtml(payload.profile || 'Not returned')}</dd></div><div><dt>Country</dt><dd>${escapeHtml(payload.countryCode || payload.country_code || 'Not returned')}</dd></div></dl>
      <div class="drawer-section"><h3>Progress</h3><div class="drawer-metrics"><div><strong>${escapeHtml(progressValue(job.progress, 'pagesProcessed', 'pages_processed'))}</strong><span>Pages processed</span></div><div><strong>${escapeHtml(progressValue(job.progress, 'companiesResolved', 'companies_resolved'))}</strong><span>Companies resolved</span></div><div><strong>${escapeHtml(progressValue(job.progress, 'pagesFailed', 'pages_failed'))}</strong><span>Page failures</span></div><div><strong>${escapeHtml(progressValue(job.progress, 'pagesDeniedByRobots', 'pages_denied_by_robots'))}</strong><span>Robots denied</span></div></div></div>
      ${job.error ? `<div class="error-card"><strong>${escapeHtml(job.error.code || 'Job failed')}</strong><p>${escapeHtml(job.error.message || 'No error detail was returned.')}</p></div>` : ''}
      <div class="drawer-section"><h3>Seed targets</h3>${seeds.length ? `<ul class="seed-list">${seeds.map((url) => `<li>${icon('globe', 15)}<span>${escapeHtml(url)}</span></li>`).join('')}</ul>` : '<p class="muted">The API did not return the safe request summary for this job.</p>'}</div>
    </div><div class="drawer__footer">${canRetry ? `<button class="button button--secondary" type="button" data-retry-job="${escapeHtml(job.id)}"${locked || pending ? ' disabled' : ''}>${pending ? 'Working…' : 'Retry job'}</button>` : ''}${canCancel ? `<button class="button button--danger" type="button" data-cancel-job="${escapeHtml(job.id)}"${locked || pending ? ' disabled' : ''}>${pending ? 'Working…' : 'Cancel job'}</button>` : ''}${job.status === 'completed' ? `<a class="button button--primary" href="#/results" data-view-results="${escapeHtml(job.id)}">View results</a>` : ''}</div>`;
}

function renderResultDrawer(item, state) {
  if (!item)
    return '<div class="drawer__body"><div class="empty-state"><strong>Result is unavailable</strong><span>Reload the selected result page and try again.</span></div></div>';
  const record = item.record || {};
  const evidence = Object.entries(record.evidence || {})
    .flatMap(([field, entries]) => (entries || []).map((entry) => ({ field, ...entry })))
    .slice(0, 25);
  const contactRows = [
    ['Emails', record.emails || []],
    ['Phones', record.phones || []],
    ['Addresses', record.addresses || []],
    ['Social profiles', record.socialProfiles || []],
  ];
  return `<div class="drawer__header"><div><p class="eyebrow">Result ${escapeHtml(shortId(item.id))}</p><h2>${escapeHtml(record.displayName || record.legalName || record.domain || 'Business result')}</h2></div><button class="icon-button" type="button" data-close-drawer aria-label="Close result details">${icon('close', 20)}</button></div>
    <div class="drawer__body">${stateBanner(state, 'drawer', 'result details')}<div class="drawer-status"><div>${badge(`${Math.round(Number(record.confidence || 0) * 100)}% confidence`, 'info')}<span>${escapeHtml(record.domain || 'No domain')}</span></div></div>
      <dl class="detail-list"><div><dt>Result ID</dt><dd><code>${escapeHtml(item.id)}</code><button class="copy-button" type="button" data-copy="${escapeHtml(item.id)}" aria-label="Copy result ID">${icon('copy', 15)}</button></dd></div><div><dt>Legal name</dt><dd>${escapeHtml(record.legalName || 'Not observed')}</dd></div><div><dt>Website</dt><dd>${escapeHtml(record.website || record.domain || 'Not observed')}</dd></div><div><dt>First seen</dt><dd>${escapeHtml(formatDateTime(record.firstSeenAt))}</dd></div><div><dt>Last seen</dt><dd>${escapeHtml(formatDateTime(record.lastSeenAt))}</dd></div><div><dt>EIN status</dt><dd>${escapeHtml(record.einStatus || 'not_observed')}</dd></div></dl>
      ${contactRows.map(([label, values]) => `<div class="drawer-section"><h3>${escapeHtml(label)}</h3>${values.length ? `<ul class="seed-list">${values.map((value) => `<li><span>${escapeHtml(value)}</span><button class="copy-button" type="button" data-copy="${escapeHtml(value)}" aria-label="Copy ${escapeHtml(label)} value">${icon('copy', 15)}</button></li>`).join('')}</ul>` : '<p class="muted">No value observed.</p>'}</div>`).join('')}
      <div class="drawer-section"><h3>Categories</h3><div class="tag-cloud">${(record.categories || []).length ? record.categories.map((value) => badge(value, 'neutral')).join('') : '<span class="muted">Unclassified</span>'}</div></div>
      <div class="drawer-section"><h3>Evidence</h3>${evidence.length ? `<ul class="evidence-list">${evidence.map((entry) => `<li><strong>${escapeHtml(entry.field)}</strong><span>${escapeHtml(entry.extractor || 'extractor')} · ${escapeHtml(entry.sourceUrl || 'source unavailable')}</span><small>${escapeHtml(formatDateTime(entry.capturedAt))}</small></li>`).join('')}</ul>` : '<p class="muted">No field-level evidence was returned in this result page.</p>'}</div>
    </div><div class="drawer__footer"><button class="button button--secondary" type="button" data-copy="${escapeHtml(record.website || record.domain || item.id)}">Copy primary reference</button></div>`;
}

export function renderDrawer(state) {
  if (!state.drawer) return '';
  if (state.drawer.type === 'result')
    return renderResultDrawer(
      state.results.find((item) => item.id === state.drawer.id),
      state,
    );
  return renderJobDrawer(
    state.jobs.find((job) => job.id === state.drawer.id),
    state,
  );
}

export function renderRoute(route, state) {
  const renderers = {
    overview: renderOverview,
    jobs: renderJobs,
    'new-crawl': renderNewCrawl,
    results: renderResults,
    reviews: renderReviews,
    deliveries: renderDeliveries,
    integrations: renderIntegrations,
    audit: renderAudit,
  };
  return (renderers[route] || renderOverview)(state);
}
