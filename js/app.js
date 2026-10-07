/* app.js — sql.js loading, search/filter, rendering */
"use strict";

let db = null;
const PAGE_SIZE = 50;

const state = {
  tab: "entries",
  q: "",
  types: new Set(),
  statuses: new Set(),
  month: "",
  followup: "",
  sort: "desc",
  offset: 0,
  reportType: "",
  reportsLoaded: false,
  statsLoaded: false,
};

/* ================= helpers ================= */

const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function fmtTs(ts) {
  return ts ? String(ts).replace("T", " ").slice(0, 19) : "";
}
function fmtShort(ts) {
  return ts ? String(ts).replace("T", " ").slice(0, 16) : "";
}

function highlight(text, q) {
  const t = String(text == null ? "" : text);
  if (!q) return esc(t);
  const lower = t.toLowerCase(), needle = q.toLowerCase();
  let out = "", i = 0;
  for (;;) {
    const j = lower.indexOf(needle, i);
    if (j === -1) { out += esc(t.slice(i)); break; }
    out += esc(t.slice(i, j)) + "<mark>" + esc(t.slice(j, j + needle.length)) + "</mark>";
    i = j + needle.length;
  }
  return out;
}

function debounce(fn, ms) {
  let h;
  return function (...args) { clearTimeout(h); h = setTimeout(() => fn.apply(this, args), ms); };
}

/* ================= unlock ================= */

async function unlock(password) {
  const status = $("lock-status");
  const errBox = $("lock-error");
  const btn = $("unlock-btn");
  errBox.hidden = true;
  btn.disabled = true;
  try {
    status.textContent = "Fetching encrypted database…";
    const res = await fetch("data/log.enc", { cache: "no-store" });
    if (!res.ok) throw new Error("Cannot fetch data/log.enc (HTTP " + res.status + ")");
    const blob = new Uint8Array(await res.arrayBuffer());

    status.textContent = "Decrypting…";
    const plainBytes = await decryptBlob(password, blob);

    status.textContent = "Opening database…";
    const SQL = await initSqlJs({ locateFile: (f) => "vendor/" + f });
    db = new SQL.Database(plainBytes);
    db.exec("SELECT count(*) FROM log_entries"); // sanity check

    try { sessionStorage.setItem("pw", password); } catch (e) { /* storage disabled */ }
    showApp();
  } catch (err) {
    db = null;
    const msg = String(err && err.message || err);
    const wrongPassword =
      err && (err.name === "OperationError" || err.name === "InvalidAccessError");
    errBox.textContent = wrongPassword ? "Wrong password" : msg;
    errBox.hidden = false;
    status.textContent = "";
    const pw = $("password-input");
    pw.value = "";
    pw.focus();
  } finally {
    btn.disabled = false;
  }
}

/* ================= query ================= */

function buildWhere() {
  const conds = [], params = [];
  if (state.types.size) {
    conds.push(`type IN (${Array(state.types.size).fill("?").join(",")})`);
    params.push(...state.types);
  }
  if (state.statuses.size) {
    conds.push(`status IN (${Array(state.statuses.size).fill("?").join(",")})`);
    params.push(...state.statuses);
  }
  if (state.month) { conds.push("substr(timestamp,1,7) = ?"); params.push(state.month); }
  if (state.followup) { conds.push("follow_up = ?"); params.push(state.followup); }
  if (state.q) {
    conds.push("(instr(lower(activity), lower(?)) > 0" +
               " OR instr(lower(coalesce(follow_up,'')), lower(?)) > 0" +
               " OR instr(CAST(id AS TEXT), ?) > 0)");
    params.push(state.q, state.q, state.q);
  }
  return { where: conds.length ? "WHERE " + conds.join(" AND ") : "", params };
}

function queryRows(sql, params) {
  const stmt = db.prepare(sql);
  stmt.bind(params || []);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function queryOne(sql, params) {
  const rows = queryRows(sql, params);
  return rows.length ? rows[0] : null;
}

/* ================= entries ================= */

function refreshEntries(append) {
  const { where, params } = buildWhere();
  const total = queryOne(`SELECT count(*) AS c FROM log_entries ${where}`, params).c;
  const offset = append ? state.offset : 0;
  const dir = state.sort === "desc" ? "DESC" : "ASC";
  const rows = queryRows(
    `SELECT id, timestamp, type, status, follow_up, eta, reference_id, activity
     FROM log_entries ${where} ORDER BY timestamp ${dir}, id ${dir} LIMIT ? OFFSET ?`,
    [...params, PAGE_SIZE, offset]
  );
  state.offset = offset + rows.length;

  const list = $("entries-list");
  if (!append) list.innerHTML = "";
  if (rows.length === 0 && !append) {
    list.innerHTML = '<div class="empty">No entries match the current filters</div>';
  } else {
    const frag = document.createElement("div");
    frag.innerHTML = rows.map(entryHTML).join("");
    while (frag.firstChild) list.appendChild(frag.firstChild);
    decorateOverflow(list);
  }

  $("result-count").textContent =
    `showing ${state.offset} of ${total} ${total === 1 ? "entry" : "entries"}`;
  $("load-more").hidden = state.offset >= total;
}

function entryHTML(r) {
  const q = state.q;
  const eta = r.eta ? `<span>${esc("ETA " + fmtShort(r.eta))}</span>` : "";
  const ref = r.reference_id
    ? `<button class="ref-link" data-ref="${r.reference_id}">&#8599; ref #${r.reference_id}</button>` : "";
  const fu = r.follow_up
    ? `<span>F/U: <b>${highlight(r.follow_up, q)}</b></span>` : "";
  return `<article class="entry type-${esc(r.type)}" id="entry-${r.id}" data-id="${r.id}">
    <div class="entry-head">
      <span class="entry-id">#${r.id}</span>
      <span class="badge badge-type">${esc(r.type)}</span>
      <span class="badge badge-status s-${esc(r.status)}">${esc(r.status)}</span>
      <span class="entry-ts">${esc(fmtTs(r.timestamp))}</span>
      <span class="entry-meta">${eta}</span>
    </div>
    <div class="entry-body">${highlight(r.activity, q)}</div>
    <button class="expand-btn" hidden>Show more</button>
    <div class="entry-foot">${fu}${ref}</div>
  </article>`;
}

function decorateOverflow(scope) {
  requestAnimationFrame(() => {
    scope.querySelectorAll(".entry-body").forEach((body) => {
      if (body.scrollHeight > body.clientHeight + 4) {
        const btn = body.parentElement.querySelector(".expand-btn");
        if (btn) btn.hidden = false;
      }
    });
  });
}

/* ================= entry modal (reference jump) ================= */

function openEntryModal(id) {
  const r = queryOne(
    `SELECT id, timestamp, type, status, follow_up, eta, reference_id, activity
     FROM log_entries WHERE id = ?`, [id]);
  const body = $("modal-body");
  if (!r) {
    body.innerHTML = `<div class="empty">Entry #${esc(id)} not found</div>`;
  } else {
    body.innerHTML = entryHTML(r);
    decorateOverflow(body);
  }
  $("modal").hidden = false;
}

/* ================= reports ================= */

function renderReports() {
  const conds = [], params = [];
  if (state.reportType) { conds.push("report_type = ?"); params.push(state.reportType); }
  const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
  const rows = queryRows(
    `SELECT id, report_type, period_start, period_end, generated_at, content
     FROM analysis_reports ${where} ORDER BY generated_at DESC`, params);

  const list = $("reports-list");
  if (!rows.length) {
    list.innerHTML = '<div class="empty">No reports</div>';
    return;
  }
  list.innerHTML = rows.map((r, i) => {
    const period = r.period_start
      ? `${r.period_start} → ${r.period_end || "?"}`
      : "—";
    let body;
    try { body = marked.parse(String(r.content || "")); }
    catch (e) { body = `<pre>${esc(r.content)}</pre>`; }
    return `<div class="report">
      <div class="report-head" data-report="${r.id}">
        <span class="badge badge-type">${esc(r.report_type)}</span>
        <span class="report-period">${esc(period)}</span>
        <span class="report-generated">${esc(fmtTs(r.generated_at))}</span>
      </div>
      <div class="report-body" id="rbody-${r.id}"${i === 0 ? "" : " hidden"}>${body}</div>
    </div>`;
  }).join("");
}

/* ================= stats ================= */

function barsCard(title, pairs, color) {
  const max = Math.max(1, ...pairs.map((p) => p[1]));
  const rows = pairs.map(([label, n]) =>
    `<div class="stat-row">
       <span class="lbl">${esc(label)}</span>
       <span class="bar" style="width:${Math.max(3, Math.round((n / max) * 130))}px;${color ? "background:" + color : ""}"></span>
       <span class="val">${n}</span>
     </div>`).join("");
  return `<div class="stat-card"><h3>${esc(title)}</h3>${rows}</div>`;
}

function renderStats() {
  const total = queryOne("SELECT count(*) AS c FROM log_entries").c;
  const last = queryOne("SELECT max(timestamp) AS t FROM log_entries").t;
  const byType = queryRows("SELECT type AS l, count(*) AS n FROM log_entries GROUP BY type ORDER BY n DESC");
  const byStatus = queryRows("SELECT status AS l, count(*) AS n FROM log_entries GROUP BY status ORDER BY n DESC");
  const byMonth = queryRows("SELECT substr(timestamp,1,7) AS l, count(*) AS n FROM log_entries GROUP BY 1 ORDER BY 1 DESC LIMIT 12").reverse();
  const reports = queryOne("SELECT count(*) AS c FROM analysis_reports").c;
  const openItems = queryOne(
    "SELECT count(*) AS c FROM log_entries WHERE status IN ('PENDING','ONGOING')").c;

  $("stats-content").innerHTML = `
    <div class="stat-card">
      <h3>Overview</h3>
      <div class="stat-big">${total}</div>
      <div class="stat-sub">entries in database</div>
      <div class="stat-row"><span class="lbl">Last update</span><span class="val">${esc(fmtTs(last))}</span></div>
      <div class="stat-row"><span class="lbl">Reports</span><span class="val">${reports}</span></div>
      <div class="stat-row"><span class="lbl">Open items</span><span class="val">${openItems}</span></div>
    </div>
    ${barsCard("By type", byType.map(r => [r.l, r.n]))}
    ${barsCard("By status", byStatus.map(r => [r.l, r.n]))}
    ${barsCard("By month", byMonth.map(r => [r.l, r.n]), "#35c07c")}`;
}

/* ================= filters ================= */

function populateFilters() {
  const monthSel = $("month-select");
  const months = queryRows(
    "SELECT substr(timestamp,1,7) AS m, count(*) AS c FROM log_entries GROUP BY 1 ORDER BY 1 DESC");
  monthSel.innerHTML = '<option value="">All months</option>' +
    months.map(r => `<option value="${r.m}">${r.m} (${r.c})</option>`).join("");

  const fuSel = $("followup-select");
  const fus = queryRows(
    "SELECT DISTINCT follow_up AS f FROM log_entries " +
    "WHERE follow_up IS NOT NULL AND trim(follow_up) <> '' ORDER BY 1");
  fuSel.innerHTML = '<option value="">Any follow-up</option>' +
    fus.map(r => {
      const flat = String(r.f).replace(/\s+/g, " ").trim();
      const label = flat.length > 60 ? flat.slice(0, 57) + "…" : flat;
      return `<option value="${esc(r.f)}">${esc(label)}</option>`;
    }).join("");

  const rtSel = $("report-type-select");
  const rts = queryRows("SELECT DISTINCT report_type AS t FROM analysis_reports ORDER BY 1");
  rtSel.innerHTML = '<option value="">All report types</option>' +
    rts.map(r => `<option value="${esc(r.t)}">${esc(r.t)}</option>`).join("");
}

function renderMeta() {
  const total = queryOne("SELECT count(*) AS c FROM log_entries").c;
  const last = queryOne("SELECT max(timestamp) AS t FROM log_entries").t;
  $("db-meta").textContent = `${total} entries · updated ${fmtTs(last)}`;
}

function syncChipsUI() {
  document.querySelectorAll("#type-chips .chip").forEach(c =>
    c.classList.toggle("on", state.types.has(c.dataset.value)));
  document.querySelectorAll("#status-chips .chip").forEach(c =>
    c.classList.toggle("on", state.statuses.has(c.dataset.value)));
  $("month-select").value = state.month;
  $("followup-select").value = state.followup;
  $("search-input").value = state.q;
  $("sort-btn").innerHTML = state.sort === "desc" ? "&#8595; newest" : "&#8593; oldest";
}

function resetFilters() {
  state.q = "";
  state.types.clear();
  state.statuses.clear();
  state.month = "";
  state.followup = "";
  state.sort = "desc";
  state.offset = 0;
  syncChipsUI();
  refreshEntries(false);
  syncHash();
}

/* ================= tabs ================= */

function switchTab(tab) {
  state.tab = tab;
  document.querySelectorAll(".tab").forEach(t =>
    t.classList.toggle("active", t.dataset.tab === tab));
  $("panel-entries").hidden = tab !== "entries";
  $("panel-reports").hidden = tab !== "reports";
  $("panel-stats").hidden = tab !== "stats";

  if (tab === "reports" && !state.reportsLoaded) { renderReports(); state.reportsLoaded = true; }
  if (tab === "stats") renderStats();
  syncHash();
}

/* ================= url hash ================= */

function syncHash() {
  const p = new URLSearchParams();
  if (state.tab !== "entries") p.set("tab", state.tab);
  if (state.q) p.set("q", state.q);
  if (state.types.size) p.set("type", [...state.types].join(","));
  if (state.statuses.size) p.set("status", [...state.statuses].join(","));
  if (state.month) p.set("month", state.month);
  if (state.followup) p.set("fu", state.followup);
  if (state.sort !== "desc") p.set("sort", state.sort);
  const s = p.toString();
  history.replaceState(null, "", s ? "#" + s : location.pathname + location.search);
}

function fillSet(set, csv) {
  set.clear();
  for (const v of csv.split(",")) if (v) set.add(v);
}

function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  state.q = p.get("q") || "";
  state.month = p.get("month") || "";
  state.followup = p.get("fu") || "";
  state.sort = p.get("sort") === "asc" ? "asc" : "desc";
  fillSet(state.types, p.get("type") || "");
  fillSet(state.statuses, p.get("status") || "");
  syncChipsUI();
  const tab = p.get("tab");
  if (tab === "reports" || tab === "stats" || tab === "entries") state.tab = tab;
}

/* ================= app start ================= */

function showApp() {
  $("lock-screen").hidden = true;
  $("app").hidden = false;
  $("password-input").value = "";
  populateFilters();
  readHash();
  renderMeta();
  refreshEntries(false);
  switchTab(state.tab);
}

function lockNow() {
  try { sessionStorage.removeItem("pw"); } catch (e) { /* ignore */ }
  if (db) { db.close(); db = null; }
  location.reload();
}

document.addEventListener("DOMContentLoaded", () => {
  /* auto-unlock from session (same tab, after reload) */
  let saved = null;
  try { saved = sessionStorage.getItem("pw"); } catch (e) { /* ignore */ }
  if (saved) {
    $("lock-status").textContent = "Restoring session…";
    unlock(saved);
  }

  /* unlock form */
  $("unlock-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const pw = $("password-input").value;
    if (pw) unlock(pw);
  });

  /* lock button */
  $("lock-btn").addEventListener("click", lockNow);

  /* tabs */
  document.querySelectorAll(".tab").forEach(t =>
    t.addEventListener("click", () => switchTab(t.dataset.tab)));

  /* search */
  $("search-input").addEventListener("input", debounce((e) => {
    state.q = e.target.value.trim();
    state.offset = 0;
    refreshEntries(false);
    syncHash();
  }, 200));

  /* chips */
  function chipHandler(groupId, set) {
    $(groupId).addEventListener("click", (e) => {
      const chip = e.target.closest(".chip");
      if (!chip) return;
      const v = chip.dataset.value;
      if (set.has(v)) set.delete(v); else set.add(v);
      chip.classList.toggle("on");
      state.offset = 0;
      refreshEntries(false);
      syncHash();
    });
  }
  chipHandler("type-chips", state.types);
  chipHandler("status-chips", state.statuses);

  /* selects */
  $("month-select").addEventListener("change", (e) => {
    state.month = e.target.value; state.offset = 0;
    refreshEntries(false); syncHash();
  });
  $("followup-select").addEventListener("change", (e) => {
    state.followup = e.target.value; state.offset = 0;
    refreshEntries(false); syncHash();
  });
  $("report-type-select").addEventListener("change", (e) => {
    state.reportType = e.target.value; renderReports();
  });

  /* sort / clear / load-more */
  $("sort-btn").addEventListener("click", () => {
    state.sort = state.sort === "desc" ? "asc" : "desc";
    state.offset = 0;
    syncChipsUI();
    refreshEntries(false);
    syncHash();
  });
  $("clear-btn").addEventListener("click", resetFilters);
  $("load-more").addEventListener("click", () => refreshEntries(true));

  /* expand / reference clicks (event delegation) */
  document.addEventListener("click", (e) => {
    const exp = e.target.closest(".expand-btn");
    if (exp) {
      const body = exp.previousElementSibling;
      const open = body.classList.toggle("expanded");
      exp.textContent = open ? "Show less" : "Show more";
      return;
    }
    const ref = e.target.closest(".ref-link");
    if (ref) { openEntryModal(parseInt(ref.dataset.ref, 10)); return; }
    const head = e.target.closest(".report-head");
    if (head) {
      const body = document.getElementById("rbody-" + head.dataset.report);
      if (body) body.hidden = !body.hidden;
      return;
    }
    if (e.target.closest("#modal-close") || e.target.id === "modal") {
      $("modal").hidden = true;
    }
  });
});
