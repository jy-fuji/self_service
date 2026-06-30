/* ============================================================
   Self-Service Provisioning — front-end (API-driven SPA)
   Talks to the FastAPI backend; no client-side simulation.
   ============================================================ */
(function () {
  "use strict";
  const ICON = window.ICON;
  const REF = window.REF;

  // ---------- API ----------
  async function jget(u) { const r = await fetch(u); if (!r.ok) throw new Error(await r.text()); return r.json(); }
  async function jpost(u, body) {
    const r = await fetch(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : null });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || r.statusText);
    return r.json();
  }
  const API = {
    config: () => jget("/api/config"),
    list: () => jget("/api/requests"),
    get: (id) => jget("/api/requests/" + id),
    create: (text, channel) => jpost("/api/requests", { text, channel }),
    approve: (id) => jpost("/api/requests/" + id + "/approve"),
    reject: (id) => jpost("/api/requests/" + id + "/reject"),
    destroy: (id) => jpost("/api/requests/" + id + "/destroy"),
    extend: (id) => jpost("/api/requests/" + id + "/extend"),
    resources: () => jget("/api/resources"),
    standards: () => jget("/api/standards"),
    chat: (message, history) => jpost("/api/chat", { message, history }),
    reset: () => jpost("/api/reset"),
  };

  // ---------- state ----------
  const STATE = { requests: [], byId: {}, config: null, role: localStorage.getItem("ssp_role") || "alice" };
  function setReq(r) { STATE.byId[r.id] = r; const i = STATE.requests.findIndex((x) => x.id === r.id); if (i >= 0) STATE.requests[i] = r; else STATE.requests.unshift(r); }
  function isAdmin() { return STATE.role === "bob"; }

  // ---------- helpers ----------
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const money = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const money0 = (n) => "$" + Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fmtDate(iso) { if (!iso) return "—"; const [d, t] = String(iso).split("T"); const p = d.split("-").map(Number); const hm = t ? t.slice(0, 5) : ""; return MON[p[1] - 1] + " " + p[2] + ", " + p[0] + (hm ? " · " + hm : ""); }
  function truncate(s, n) { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
  function secsSince(iso) { try { return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000)); } catch (e) { return 0; } }
  function ttlText(iso) { if (!iso) return ""; const ms = new Date(iso).getTime() - Date.now(); if (ms <= 0) return "expired"; const m = Math.round(ms / 60000); const h = Math.floor(m / 60), mm = m % 60; return h > 0 ? `${h}h ${mm}m` : `${mm}m`; }

  const KIND = {
    storage_account: { icon: "box", color: "amber", label: "Storage Account" },
    virtual_machine: { icon: "server", color: "blue", label: "Virtual Machine" },
    postgresql_flex: { icon: "database", color: "teal", label: "PostgreSQL Flexible Server" },
    sql_database: { icon: "database", color: "violet", label: "Azure SQL Database" },
  };
  const bgClass = { blue: "bg-blue", teal: "bg-teal", violet: "bg-violet", amber: "bg-amber", green: "bg-green", red: "bg-red", slate: "bg-slate" };

  const STATUS = {
    processing: { cls: "info", label: "Processing", icon: "cpu" },
    awaiting_approval: { cls: "warning", label: "Awaiting approval", icon: "clock" },
    deploying: { cls: "info", label: "Deploying", icon: "refresh" },
    deployed: { cls: "success", label: "Deployed", icon: "check-circle" },
    rejected: { cls: "danger", label: "Rejected", icon: "x-circle" },
    error: { cls: "danger", label: "Failed", icon: "alert-triangle" },
    expired: { cls: "neutral", label: "Expired · deleted", icon: "clock" },
    destroyed: { cls: "neutral", label: "Deleted", icon: "refresh" },
    clarifying: { cls: "info", label: "Clarification", icon: "help-circle" },
    denied: { cls: "danger", label: "Policy denied", icon: "x-circle" },
  };
  function statusBadge(s) { const m = STATUS[s] || STATUS.processing; return `<span class="badge ${m.cls}">${ICON(m.icon)}${m.label}</span>`; }
  const TERMINAL = (s) => s !== "processing" && s !== "deploying";

  // ---------- toast ----------
  function toast(title, msg, kind) {
    const wrap = $("#toasts"); const t = document.createElement("div"); t.className = "toast " + (kind || "");
    const ic = { success: "check-circle", danger: "x-circle", warning: "alert-triangle" }[kind] || "info";
    const col = kind === "success" ? "success" : kind === "danger" ? "danger" : kind === "warning" ? "warning" : "primary";
    t.innerHTML = `<span class="t-ico" style="color:var(--${col})">${ICON(ic)}</span><div><div class="t-title">${esc(title)}</div>${msg ? `<div class="t-msg">${esc(msg)}</div>` : ""}</div>`;
    wrap.appendChild(t);
    setTimeout(() => { t.style.opacity = "0"; t.style.transform = "translateX(20px)"; t.style.transition = "all .25s"; setTimeout(() => t.remove(), 260); }, 4200);
  }

  // ============================================================ SHELL
  const NAV = [
    { group: "Overview", items: [{ p: "/", label: "Dashboard", icon: "grid" }] },
    { group: "Provisioning", items: [
      { p: "/request/new", label: "New Request", icon: "plus-circle" },
      { p: "/requests", label: "Requests", icon: "list" },
      { p: "/approvals", label: "Approvals", icon: "check-square", badge: "pending" },
    ] },
    { group: "Platform", items: [
      { p: "/resources", label: "Landing Zone", icon: "cloud" },
      { p: "/governance", label: "Governance", icon: "shield" },
      { p: "/catalog", label: "Standards & Catalog", icon: "book" },
    ] },
  ];
  function pendingCount() { return STATE.requests.filter((r) => r.status === "awaiting_approval").length; }

  function mountShell() {
    const path = curPath();
    const u = isAdmin() ? { name: "Bob Carver", id: "bob@contoso.com", av: "BC", color: "#6b40d6", role: "Platform Administrator" }
                        : { name: "Alice Nguyen", id: "alice@contoso.com", av: "AN", color: "#1d63ff", role: "Self-Service Requestor" };
    let nav = "";
    NAV.forEach((g) => {
      nav += `<div class="group">${g.group}</div>`;
      g.items.forEach((it) => {
        const active = it.p === "/" ? path === "/" : path.indexOf(it.p) === 0;
        let badge = "";
        if (it.badge === "pending") { const c = pendingCount(); if (c) badge = `<span class="badge-count">${c}</span>`; }
        nav += `<a href="#${it.p}" class="${active ? "active" : ""}">${ICON(it.icon)}<span>${it.label}</span>${badge}</a>`;
      });
    });
    $("#rail").innerHTML = `
      <div class="brand"><div class="mark">Fj</div>
        <div class="who"><div class="t">Data-AI Automation</div><div class="s">Self-Service Provisioning</div></div></div>
      <nav class="nav">${nav}</nav>
      <div class="who-foot"><div class="role-switch">
        <div class="lbl">Viewing as</div>
        <div class="role-toggle">
          <button data-role="alice" class="${!isAdmin() ? "on" : ""}">Requester</button>
          <button data-role="bob" class="${isAdmin() ? "on" : ""}">Admin</button></div>
        <div class="who-card"><div class="av" style="background:${u.color}">${u.av}</div>
          <div class="who2"><div class="n">${u.name}</div><div class="e">${u.id}</div></div></div>
      </div></div>`;
    $$("#rail .role-toggle button").forEach((b) => b.addEventListener("click", () => {
      STATE.role = b.dataset.role; localStorage.setItem("ssp_role", STATE.role); mountShell(); router();
    }));

    const lz = (STATE.config && STATE.config.landing_zone) || {};
    const crumbs = crumbFor(path);
    $("#topbar").innerHTML = `
      <div class="crumbs">${crumbs}</div>
      <div class="search">${ICON("search")}<input placeholder="Search requests, resources…"><kbd>Ctrl K</kbd></div>
      <div class="spacer"></div>
      <div class="lz-chip"><span class="pulse"></span><span>Landing zone</span><strong style="color:var(--ink)">${esc((STATE.config && STATE.config.landing_zone_name) || lz.name || "lz-sandbox-01")}</strong></div>
      <button class="icon-btn" id="resetBtn" title="Reset demo data">${ICON("refresh")}</button>
      <a class="btn primary sm" href="#/request/new">${ICON("plus")}New Request</a>`;
    const rb = $("#resetBtn");
    if (rb) rb.addEventListener("click", async () => { await API.reset(); await loadRequests(); router(); toast("Reset", "Request history cleared.", "success"); });
  }
  function crumbFor(path) {
    const home = `<a href="#/">Provisioning</a>`, sep = `<span class="sep">/</span>`;
    const map = { "/": "Dashboard", "/request/new": "New Request", "/requests": "Requests", "/approvals": "Approvals", "/resources": "Landing Zone", "/governance": "Governance", "/catalog": "Standards & Catalog" };
    if (path.indexOf("/request/") === 0 && path !== "/request/new")
      return [home, sep, `<a href="#/requests">Requests</a>`, sep, `<span class="cur">${esc(path.split("/")[2])}</span>`].join("");
    return [home, sep, `<span class="cur">${map[path] || "Dashboard"}</span>`].join("");
  }

  // ============================================================ ROUTER
  function curPath() { return (location.hash.replace(/^#/, "") || "/").split("?")[0]; }
  function setView(html) { $("#view").innerHTML = `<div class="view-fade">${html}</div>`; }

  async function router() {
    const path = curPath();
    stopPoll();
    mountShell();
    try {
      if (path === "/") await viewDashboard();
      else if (path === "/request/new") viewNewRequest();
      else if (path.indexOf("/request/") === 0) await viewRequestDetail(path.split("/")[2]);
      else if (path === "/requests") await viewRequests();
      else if (path === "/approvals") await viewApprovals();
      else if (path === "/resources") await viewResources();
      else if (path === "/governance") viewGovernance();
      else if (path === "/catalog") await viewCatalog();
      else setView(`<div class="empty"><div class="e-ico">${ICON("search")}</div><h3>Not found</h3></div>`);
    } catch (e) {
      setView(`<div class="empty"><div class="e-ico">${ICON("alert-triangle")}</div><h3>Something went wrong</h3><p>${esc(e.message)}</p></div>`);
    }
    window.scrollTo(0, 0);
  }
  function wireGo(root) { $$("[data-go]", root || document).forEach((n) => n.addEventListener("click", () => { location.hash = n.dataset.go; })); }
  async function loadRequests() { STATE.requests = await API.list(); STATE.requests.forEach((r) => (STATE.byId[r.id] = r)); }

  // ============================================================ CHARTS
  function barChart(data, labels, h) {
    const W = 600, H = h || 170, pad = 26, gap = 8;
    const max = Math.max.apply(null, data.concat([1])) * 1.15;
    const bw = (W - pad * 2 - gap * (data.length - 1)) / data.length;
    let bars = "", grid = "";
    for (let g = 0; g <= 3; g++) { const y = pad + (H - pad * 1.4 - pad) * (g / 3); grid += `<line class="grid-line" x1="${pad}" y1="${y}" x2="${W - pad}" y2="${y}"/>`; }
    data.forEach((v, i) => {
      const bh = (v / max) * (H - pad * 1.4 - pad), x = pad + i * (bw + gap), y = H - pad * 1.4 - bh;
      bars += `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="3" fill="url(#bg1)"></rect>`;
      if (labels[i]) bars += `<text class="axis-txt" x="${x + bw / 2}" y="${H - pad * 0.4}" text-anchor="middle">${labels[i]}</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block"><defs><linearGradient id="bg1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3d77ff"/><stop offset="1" stop-color="#1d63ff"/></linearGradient></defs>${grid}${bars}</svg>`;
  }
  function donut(segs, size) {
    const S = size || 170, r = 58, cx = S / 2, cy = S / 2, C = 2 * Math.PI * r;
    const total = segs.reduce((a, s) => a + s.v, 0) || 1; let off = 0, arcs = "";
    segs.forEach((s) => { const len = (s.v / total) * C; arcs += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${s.color}" stroke-width="16" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 ${cx} ${cy})"></circle>`; off += len; });
    return `<svg viewBox="0 0 ${S} ${S}" width="${S}" height="${S}">${arcs}</svg>`;
  }
  function hbars(data) {
    const max = Math.max.apply(null, data.map((d) => d.v).concat([1]));
    return `<div style="display:flex;flex-direction:column;gap:11px">` + data.map((d) => `<div style="display:flex;align-items:center;gap:12px"><div style="width:52px;font-size:12px;color:var(--ink-3);text-align:right" class="mono">${d.label}</div><div class="pbar" style="flex:1"><i class="bl" style="width:${(d.v / max) * 100}%"></i></div><div style="width:30px;font-size:12.5px;font-weight:600;text-align:right">${d.v}</div></div>`).join("") + `</div>`;
  }

  // ============================================================ DASHBOARD
  async function viewDashboard() {
    await loadRequests();
    const reqs = STATE.requests;
    const deployed = reqs.filter((r) => r.status === "deployed");
    const awaiting = reqs.filter((r) => r.status === "awaiting_approval");
    const durs = deployed.map((r) => r.durationMin).filter((x) => x);
    const avg = durs.length ? (durs.reduce((a, b) => a + b, 0) / durs.length) : 0;
    const succ = reqs.length ? Math.round((deployed.length / reqs.length) * 100) : 100;
    const modeInfo = modeBanner();
    const kpis = [
      { label: "Requests", val: reqs.length, ico: "inbox", bg: "bg-blue", foot: "all time" },
      { label: "Provisioned", val: deployed.length, ico: "check-circle", bg: "bg-green", foot: deployed.length + " live deployments" },
      { label: "Avg. time to provision", val: avg ? avg.toFixed(1) : "—", u: avg ? "min" : "", ico: "clock", bg: "bg-teal", foot: "approve → live" },
      { label: "Awaiting approval", val: awaiting.length, ico: "clock", bg: "bg-amber", foot: "in the queue" },
    ].map((c) => `<div class="card kpi"><div class="kpi-top"><div class="kpi-ico ${c.bg}">${ICON(c.ico)}</div><div class="kpi-label">${c.label}</div></div><div class="kpi-val">${c.val}${c.u ? `<span class="u">${c.u}</span>` : ""}</div><div class="kpi-foot"><span>${c.foot}</span></div></div>`).join("");

    const outcomes = [
      { label: "Deployed", v: deployed.length, color: "#0e8a4f" },
      { label: "Awaiting", v: awaiting.length, color: "#9a6212" },
      { label: "In flight", v: reqs.filter((r) => r.status === "processing" || r.status === "deploying").length, color: "#1d63ff" },
      { label: "Failed/Rejected", v: reqs.filter((r) => r.status === "error" || r.status === "rejected").length, color: "#c5263b" },
    ];
    const totalOut = outcomes.reduce((a, s) => a + s.v, 0);
    const legend = outcomes.map((o) => `<div class="lg"><span class="sw" style="background:${o.color}"></span>${o.label} <strong style="color:var(--ink);margin-left:2px">${o.v}</strong></div>`).join("");
    const recent = reqs.slice(0, 6).map((r) => `<tr class="clickable" data-go="#/request/${r.id}"><td class="mono strong">${r.id}</td><td>${esc(truncate(r.text, 46))}</td><td><span class="tag">${esc(r.environment || "dev")}</span></td><td>${statusBadge(r.status)}</td><td class="mono">${fmtDate(r.created).split(" · ")[0]}</td></tr>`).join("")
      || `<tr><td colspan="5"><div class="empty" style="padding:26px"><div class="e-ico">${ICON("inbox")}</div><h3>No requests yet</h3><p>Start one from <a href="#/request/new">New Request</a>.</p></div></td></tr>`;

    setView(`
      <div class="hero"><div class="hero-pattern"></div><div class="hero-inner">
        <div class="hero-text"><div class="hero-eyebrow">Fujitsu · Data-AI Automation Service · Use Case Library</div>
          <h1>AI-Governed Self-Service Provisioning</h1>
          <p class="h-sub">A natural-language request becomes a grounded, policy-shaped plan and a real, tagged Azure resource — through an approval gate, with a live CMDB. This is the working v1.</p>
          <div class="hero-cta"><a class="btn primary lg" href="#/request/new">${ICON("rocket")}Start a request</a><a class="btn lg hero-btn2" href="#/governance">${ICON("shield")}How governance works</a></div></div>
        <div class="hero-stats">${modeInfo.tiles}</div>
      </div></div>
      ${modeInfo.banner}
      <div class="grid cols-4 mt-20">${kpis}</div>
      <div class="grid cols-3 mt-20" style="grid-template-columns:2fr 1fr">
        <div class="card"><div class="card-head"><h3>Request volume</h3><span class="ch-sub">illustrative</span></div><div class="card-body">${barChart(REF.VOLUME_14D, REF.VOLUME_14D.map((_, i) => i % 2 ? "D" + (i + 1) : ""))}</div></div>
        <div class="card"><div class="card-head"><h3>Outcomes</h3><span class="ch-sub">this session</span></div><div class="card-body"><div class="donut-wrap">${donut(outcomes)}<div class="donut-center"><div class="v">${totalOut}</div><div class="l">requests</div></div></div><div class="chart-legend">${legend}</div></div></div>
      </div>
      <div class="grid cols-3 mt-20" style="grid-template-columns:2fr 1fr">
        <div class="card"><div class="card-head"><h3>Recent requests</h3><div class="ch-actions"><a class="btn sm ghost" href="#/requests">View all ${ICON("arrow-right")}</a></div></div><div class="table-wrap"><table class="tbl"><thead><tr><th>Request</th><th>Summary</th><th>Env</th><th>Status</th><th>Created</th></tr></thead><tbody>${recent}</tbody></table></div></div>
        <div class="card"><div class="card-head"><h3>Provision time</h3><span class="ch-sub">illustrative</span></div><div class="card-body">${hbars(REF.PROVISION_DIST)}</div></div>
      </div>`);
    wireGo();
  }

  function modeBanner() {
    const c = STATE.config || {};
    const mode = c.mode || "offline";
    const map = {
      "offline": { t: "Offline mode", d: "No Azure configured — planning and deployment are simulated. Add a .env to go live.", cls: "bg-slate", ic: "cpu" },
      "llm-live": { t: "Semi-simulation", d: "Real grounded planning and RAG; provisioning and the CMDB are simulated with realistic IDs — so no privileged Azure identity is needed and anyone can run the demo.", cls: "bg-blue", ic: "cpu" },
      "azure-live": { t: "Live", d: "Real grounded planning and real storage deployments into " + (c.resource_group || "the sandbox RG") + ".", cls: "bg-green", ic: "cloud" },
    };
    const m = map[mode] || map.offline;
    const tiles = [
      ["Mode", mode], ["Plan model", c.chat_deployment || "deterministic"], ["Deploy target", c.resource_group || "simulated"],
    ].map(([l, v]) => `<div class="hs"><div class="v" style="font-size:18px">${esc(v)}</div><div class="l">${l}</div></div>`).join("");
    const banner = `<div class="card pad mt-20" style="display:flex;gap:14px;align-items:center"><div class="kpi-ico ${m.cls}">${ICON(m.ic)}</div><div style="flex:1"><strong>${m.t}</strong><div class="dim">${esc(m.d)}</div></div><a class="btn sm" href="#/catalog">View standards ${ICON("arrow-right")}</a></div>`;
    return { tiles, banner };
  }

  // ============================================================ NEW REQUEST
  function viewNewRequest() {
    const prompts = (STATE.config && STATE.config.sample_prompts) || [];
    const samples = prompts.map((s) => { const tone = { ok: "bg-green", info: "bg-blue", warn: "bg-amber", deny: "bg-red" }[s.kind] || "bg-blue"; return `<button class="sample" data-q="${esc(s.q)}"><div class="s-ico ${tone}">${ICON(s.icon || "box")}</div><div><div class="s-q">${esc(s.q)}</div><div class="s-meta">${esc(s.meta || "")}</div></div></button>`; }).join("");
    setView(`
      <div class="page-head"><div class="ph-text"><h1>New provisioning request</h1>
        <p class="sub">Describe what you need in plain English. The agent grounds every choice in your organisation's standards, composes a plan, and routes it through validation and approval before deploying to the sandbox landing zone.</p></div></div>
      <div class="grid cols-2" style="grid-template-columns:1.3fr 1fr;align-items:start">
        <div>
          <div class="prompt-box"><textarea id="prompt" placeholder="e.g. I need a storage account for the retail-analytics team, dev environment."></textarea>
            <div class="pb-foot"><span class="badge outline">${ICON("user")}Alice · retail-analytics</span><span class="badge outline">${ICON("cloud")}Web Portal</span><div style="flex:1"></div><button class="btn primary" id="submitBtn">${ICON("send")}Submit request</button></div></div>
          <div class="card mt-20"><div class="card-head"><h3>What happens next</h3></div><div class="card-body"><div class="list">
            ${stepRow("search", "bg-violet", "Retrieve standards", "RAG over naming, SKU tiers, regions, tags and team overrides — with citations.")}
            ${stepRow("cpu", "bg-blue", "Plan", "A schema-validated plan composed only from approved building blocks.")}
            ${stepRow("shield-check", "bg-green", "Validate", "ARM validation / what-if-style preflight against the landing zone.")}
            ${stepRow("user-check", "bg-amber", "Approve & deploy", "A human approves, then a real storage account is provisioned and recorded in the CMDB.")}
          </div></div></div>
        </div>
        <div><div class="section-title">Try a sample request</div><div style="display:flex;flex-direction:column;gap:12px">${samples}</div></div>
      </div>`);
    $$(".sample").forEach((b) => b.addEventListener("click", () => { $("#prompt").value = b.dataset.q; $("#prompt").focus(); }));
    $("#submitBtn").addEventListener("click", submit);
    $("#prompt").addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit(); });
  }
  function stepRow(icon, bg, t, s) { return `<div class="li"><div class="li-ico ${bg}">${ICON(icon)}</div><div class="li-main"><div class="li-title">${t}</div><div class="li-sub">${s}</div></div></div>`; }
  async function submit() {
    const text = ($("#prompt").value || "").trim();
    if (!text) { toast("Empty request", "Describe what you need.", "warning"); return; }
    $("#submitBtn").disabled = true;
    try { const req = await API.create(text); setReq(req); location.hash = "/request/" + req.id; }
    catch (e) { toast("Could not submit", e.message, "danger"); $("#submitBtn").disabled = false; }
  }

  // ============================================================ POLLING
  let POLLER = null;
  function stopPoll() { if (POLLER) { clearTimeout(POLLER); POLLER = null; } }
  function pollInterval(r) {
    if (r.status === "processing" || r.status === "deploying") return 1100;
    if (r.status === "deployed" && r.expires_at) return 15000;  // refresh countdown / catch auto-delete
    return 0;
  }
  function pollDetail(id) {
    stopPoll();
    const tick = async () => {
      let r; try { r = await API.get(id); } catch (e) { return; }
      setReq(r);
      if (curPath() === "/request/" + id) renderDetail(r);
      const iv = pollInterval(r);
      if (iv) POLLER = setTimeout(tick, iv); else { POLLER = null; mountShell(); }
    };
    POLLER = setTimeout(tick, 1000);
  }

  // ============================================================ REQUEST DETAIL
  async function viewRequestDetail(id) {
    let req = STATE.byId[id];
    try { req = await API.get(id); setReq(req); } catch (e) { setView(`<div class="empty"><div class="e-ico">${ICON("search")}</div><h3>Request not found</h3><p><a href="#/requests">Back to requests</a></p></div>`); return; }
    renderDetail(req);
    if (pollInterval(req)) pollDetail(id);
  }

  const STAGE_DEFS = [
    { key: "intake", title: "Request intake", icon: "inbox", sub: "Normalized envelope from the channel" },
    { key: "retrieve", title: "Retrieve standards (RAG)", icon: "search", sub: "Grounding the plan in org standards" },
    { key: "plan", title: "Plan", icon: "cpu", sub: "Schema-validated, grounded in retrieved chunks" },
    { key: "validate", title: "Validate", icon: "shield-check", sub: "ARM validation against the landing zone" },
    { key: "approve", title: "Approval", icon: "user-check", sub: "Human gate — approve / reject" },
    { key: "deploy", title: "Deploy", icon: "git-branch", sub: "Provision into the sandbox resource group" },
    { key: "confirm", title: "Confirm & record", icon: "check-circle", sub: "Resource Graph · CMDB" },
  ];
  function deriveStages(req) {
    let st = STAGE_DEFS.map(() => "pending");
    const done = (n) => { for (let i = 0; i <= n; i++) st[i] = "done"; };
    switch (req.status) {
      case "processing": { const a = req._anim == null ? 0 : req._anim; for (let i = 0; i < a; i++) st[i] = "done"; st[a] = "active"; break; }
      case "awaiting_approval": done(3); st[4] = "wait"; break;
      case "deploying": done(4); st[5] = "active"; break;
      case "deployed": done(6); break;
      case "rejected": done(3); st[4] = "error"; break;
      case "expired": case "destroyed": done(6); break;
      case "error": { const hasDeploy = (req.deploy_log || []).length || req.approver; if (hasDeploy) { done(4); st[5] = "error"; } else { done(1); st[2] = "error"; } break; }
      default: break;
    }
    return STAGE_DEFS.map((def, i) => ({ def, state: st[i] }));
  }

  function renderDetail(req) {
    const stages = deriveStages(req);
    const totalCost = (req.resources || []).reduce((a, r) => a + (r.estimated_monthly_usd || 0), 0);
    const region = req.region || (req.resources[0] && req.resources[0].params.location) || "—";
    const head = `
      <div class="page-head"><div class="ph-text">
        <div class="center gap-10" style="margin-bottom:8px"><span class="mono" style="font-size:13px;color:var(--ink-3)">${esc(req.id)}</span>${statusBadge(req.status)}<span class="badge outline">${ICON("cloud")}${esc(req.channel)}</span><span class="badge outline">${esc(req.environment || "dev")}</span>${req.mode ? `<span class="badge ${req.mode === "azure-live" ? "success" : req.mode === "llm-live" ? "info" : "neutral"}">${req.mode}</span>` : ""}</div>
        <h1 style="font-size:19px;font-weight:600;max-width:780px;line-height:1.4">${esc(req.text)}</h1>
        <div class="center gap-12 dim" style="margin-top:8px"><span>${ICON("user")} ${esc(req.requesterName)}</span><span>· ${esc(req.team)}</span><span>· requested ${fmtDate(req.created)}</span>${req.completed ? `<span>· completed ${fmtDate(req.completed)}</span>` : ""}</div></div>
        <div class="ph-actions"><a class="btn ghost" href="#/requests">${ICON("arrow-right")}All requests</a>
          ${req.status === "awaiting_approval" && isAdmin() ? `<button class="btn danger" data-rej="${req.id}">${ICON("x")}Reject</button><button class="btn success" data-app="${req.id}">${ICON("check")}Approve &amp; deploy</button>` : ""}
          ${req.status === "awaiting_approval" && !isAdmin() ? `<span class="badge warning">${ICON("clock")}Pending admin approval</span>` : ""}
          ${req.status === "deployed" ? `<span class="badge ${ttlText(req.expires_at) === "expired" ? "danger" : "neutral"}">${ICON("clock")}expires in ${ttlText(req.expires_at)}</span><button class="btn" data-extend="${req.id}">${ICON("refresh")}Extend</button><button class="btn danger" data-destroy="${req.id}">${ICON("x")}Delete now</button>` : ""}
          ${(req.status === "expired" || req.status === "destroyed") ? `<span class="badge neutral">${ICON("refresh")}Resources deleted</span>` : ""}</div></div>`;
    const strip = `<div class="stat-strip mt-8" style="margin-bottom:22px">
      <div class="st"><div class="v">${(req.resources || []).length}</div><div class="l">Resources planned</div></div>
      <div class="st"><div class="v">${totalCost ? money(totalCost) : "—"}</div><div class="l">Est. monthly cost</div></div>
      <div class="st"><div class="v">${esc(req.environment || "dev")}</div><div class="l">Environment</div></div>
      <div class="st"><div class="v">${esc(region)}</div><div class="l">Region</div></div>
      <div class="st"><div class="v">${req.durationMin ? req.durationMin + "m" : (TERMINAL(req.status) ? "—" : "in flight")}</div><div class="l">Time to provision</div></div></div>`;
    const flow = `<div class="card pad"><div class="flow">${stages.map((s) => renderStage(req, s)).join("")}</div></div>`;
    setView(head + strip + flow);
    $$("[data-app]").forEach((b) => b.addEventListener("click", () => doApprove(b.dataset.app)));
    $$("[data-rej]").forEach((b) => b.addEventListener("click", () => doReject(b.dataset.rej)));
    $$("[data-destroy]").forEach((b) => b.addEventListener("click", () => doDestroy(b.dataset.destroy)));
    $$("[data-extend]").forEach((b) => b.addEventListener("click", () => doExtend(b.dataset.extend)));
    wireTabs();
    const cons = $(".console"); if (cons) cons.scrollTop = cons.scrollHeight;
  }

  async function doApprove(id) { try { await API.approve(id); const r = await API.get(id); setReq(r); renderDetail(r); pollDetail(id); toast("Approved", "Deploying to the landing zone…", ""); } catch (e) { toast("Approve failed", e.message, "danger"); } }
  async function doReject(id) { try { await API.reject(id); const r = await API.get(id); setReq(r); renderDetail(r); mountShell(); toast("Rejected", id + " was rejected.", "danger"); } catch (e) { toast("Failed", e.message, "danger"); } }
  async function doDestroy(id) { try { toast("Deleting", "Removing resources…", ""); await API.destroy(id); const r = await API.get(id); setReq(r); renderDetail(r); mountShell(); toast("Deleted", "Resources removed.", "success"); } catch (e) { toast("Failed", e.message, "danger"); } }
  async function doExtend(id) { try { const res = await API.extend(id); const r = await API.get(id); setReq(r); renderDetail(r); pollDetail(id); toast("Extended", "Resources now expire in " + ttlText(res.expires_at) + ".", "success"); } catch (e) { toast("Failed", e.message, "danger"); } }

  function renderStage(req, s) {
    const def = s.def, st = s.state;
    const nodeIcon = st === "done" ? "check" : st === "error" ? "x" : def.icon;
    const tag = st === "active" ? `<span class="badge info">${ICON("refresh")}Working</span>` : st === "wait" ? `<span class="badge warning">Waiting</span>` : st === "error" ? `<span class="badge danger">Stopped</span>` : st === "done" ? `<span class="badge success">${ICON("check")}Done</span>` : "";
    const detail = st !== "pending" ? stageDetail(req, def.key, st) : "";
    return `<div class="stage ${st}"><div class="rail-col"><div class="node">${ICON(nodeIcon)}</div><div class="line"></div></div>
      <div class="body"><div class="st-head"><div class="st-title">${def.title}</div>${tag}</div><div class="st-sub">${def.sub}</div>${detail ? `<div class="st-detail">${detail}</div>` : ""}</div></div>`;
  }
  function stageDetail(req, key, st) {
    if (key === "intake") return `<div class="panel"><div class="section-title">Normalized request envelope</div><pre class="code">${jsonHL({ user: req.requester, channel: req.channel, environment: req.environment, owner_team: req.team, text: req.text, requested_at: req.created })}</pre></div>`;
    if (key === "retrieve") {
      if (st === "active") return `<div class="panel dim">${ICON("search")} Retrieving grounded standards…</div>`;
      const items = (req.retrieval || []).map((r) => `<div class="r-item"><div class="r-score"><div class="s">${Math.round(r.score * 100)}</div><div class="l">match</div></div><div class="r-main"><div class="r-id">${esc(r.id)}</div><div class="r-txt">${esc(r.text)}</div><div class="scorebar"><i style="width:${Math.round(r.score * 100)}%"></i></div></div></div>`).join("");
      return `<div class="panel"><div class="between" style="margin-bottom:10px"><div class="section-title" style="margin:0">Retrieved standards · ${(req.retrieval || []).length} chunks</div><span class="dim">grounding for the plan</span></div><div class="retr">${items}</div></div>`;
    }
    if (key === "plan") {
      if (st === "active") return `<div class="panel dim">${ICON("cpu")} ${esc((STATE.config && STATE.config.chat_deployment) || "The model")} is composing a grounded plan… <strong>${secsSince(req.created)}s</strong><div style="margin-top:6px;font-size:12px">High-reasoning models can take a minute or two — the request keeps polling.</div></div>`;
      if (!(req.resources || []).length) return `<div class="panel dim">No plan yet.</div>`;
      const cards = req.resources.map(resourcePlanCard).join("");
      const total = req.resources.reduce((a, r) => a + (r.estimated_monthly_usd || 0), 0);
      return `<div class="panel"><div class="between" style="margin-bottom:12px"><div class="section-title" style="margin:0">Generated plan · ${req.resources.length} resources</div><div class="center gap-8"><span class="dim">total est.</span><strong>${money(total)}/mo</strong></div></div>
        <div class="grid" style="grid-template-columns:1fr 1fr;gap:12px">${cards}</div>
        <div class="mt-16"><div class="tabs" data-tabs><button class="on" data-tab="json">Plan (JSON)</button><button data-tab="arm">ARM template</button></div>
        <div data-tabpane="json" style="margin-top:12px"><pre class="code">${jsonHL(buildPlanJson(req))}</pre></div>
        <div data-tabpane="arm" style="margin-top:12px;display:none"><pre class="code">${jsonHL(req.arm || {})}</pre></div></div></div>`;
    }
    if (key === "validate") {
      if (st === "active") return `<div class="panel dim">${ICON("shield-check")} Validating…</div>`;
      const v = req.validation; if (!v) return "";
      const checks = [
        ["What-If / validate", "eye", v.whatIf, `${v.whatIf.create} to create · 0 destructive`],
        ["Template lint", "code", v.bicepLint, `${v.bicepLint.warnings} warnings`],
        ["Baseline rules", "sliders", v.psRule, `${v.psRule.passed} passed · ${v.psRule.failed} failed`],
        ["Policy preview", "shield", v.policyPreview, `${v.policyPreview.evaluated} rules · ${v.policyPreview.denied} denials`],
        ["RBAC / scope", "lock", v.rbac, `${v.rbac.role}`],
      ].map(([name, ic, obj, d]) => { const ok = (obj.status || "pass") === "pass"; return `<div class="center gap-10" style="padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:var(--surface)"><div class="kpi-ico ${ok ? "bg-green" : "bg-red"}" style="width:34px;height:34px">${ICON(ok ? "check" : "x")}</div><div style="flex:1"><div style="font-weight:600;font-size:13px">${name}</div><div class="dim" style="font-size:11.5px">${esc(d)}</div></div><span class="badge ${ok ? "success" : "danger"}">${ok ? "Pass" : "Fail"}</span></div>`; }).join("");
      return `<div class="panel"><div class="grid" style="grid-template-columns:1fr 1fr;gap:10px">${checks}</div></div>`;
    }
    if (key === "approve") return approveDetail(req, st);
    if (key === "deploy") {
      const lines = req.deploy_log || [];
      if (st === "pending") return "";
      const consoleHtml = `<div class="console">${lines.map((l) => `<div class="ln"><span class="lv ${l[0]}">${l[0].toUpperCase()}</span><span class="msg">${esc(l[1])}</span></div>`).join("") || `<div class="ln dim">starting…</div>`}${st === "active" ? `<div class="ln"><span class="lv run">RUN</span><span class="msg">working…</span></div>` : ""}</div>`;
      return `<div class="panel"><div class="between" style="margin-bottom:10px"><div class="section-title" style="margin:0">Deployment log</div><span class="badge ${st === "done" ? "success" : st === "error" ? "danger" : "info"}">${st === "done" ? "succeeded" : st === "error" ? "failed" : "running"}</span></div>${consoleHtml}${req.error && st === "error" ? `<div class="dim mt-12" style="color:var(--danger)">${esc(req.error)}</div>` : ""}</div>`;
    }
    if (key === "confirm") {
      if (st !== "done") return `<div class="panel dim">Pending deployment.</div>`;
      const rg = (STATE.config && STATE.config.resource_group) || "rg-selfservice-lz";
      const gone = (req.status === "expired" || req.status === "destroyed");
      const rows = (req.resources || []).map((r) => { const k = KIND[r.kind] || { icon: "box", color: "amber", label: r.kind }; const ep = r.kind === "storage_account" ? `https://${r.naming}.blob.core.windows.net/` : ""; return `<div class="li"><div class="li-ico ${bgClass[k.color]}">${ICON(k.icon)}</div><div class="li-main"><div class="li-title mono">${esc(r.naming)}</div><div class="li-sub">${k.label} · ${esc(r.params.location)}${ep ? ` · <span class="mono">${esc(ep)}</span>` : ""}</div></div><span class="badge ${gone ? "neutral" : "success"}">${gone ? "Deleted" : "<span class=\"bd\"></span>Live"}</span></div>`; }).join("");
      const ttlBanner = gone
        ? `<div class="panel" style="background:var(--surface-2);margin-bottom:12px"><div class="center gap-10">${ICON("refresh")}<div><strong>Resources deleted</strong><div class="dim">${req.status === "expired" ? "Auto-deleted at TTL expiry" : "Deleted on request"}${req.deleted_at ? " · " + fmtDate(req.deleted_at) : ""}</div></div></div></div>`
        : `<div class="panel" style="background:var(--warning-soft);border-color:#f5dca8;margin-bottom:12px"><div class="between"><div class="center gap-10">${ICON("clock")}<div><strong>Auto-deletes in ${ttlText(req.expires_at)}</strong><div class="dim">Resources are cleaned up automatically to keep the sandbox tidy and costs near zero.</div></div></div><div class="center gap-8"><button class="btn sm" data-extend="${req.id}">${ICON("refresh")}Extend</button><button class="btn sm danger" data-destroy="${req.id}">${ICON("x")}Delete now</button></div></div></div>`;
      const header = gone ? `${ICON("refresh")}<strong>These resources were provisioned in ${esc(rg)}</strong>` : `${ICON("check-circle")}<strong style="color:var(--success)">Resources are live in ${esc(rg)}</strong>`;
      return `<div class="panel">${ttlBanner}<div class="center gap-10" style="margin-bottom:12px">${header}</div>
        <div class="grid" style="grid-template-columns:1fr 1fr;gap:16px"><div><div class="section-title">Provisioned resources</div><div class="list">${rows}</div><div class="mt-12"><a class="btn sm" href="#/resources">${ICON("cloud")}View in CMDB</a></div></div>
        <div><div class="section-title">CMDB record</div><pre class="code" style="max-height:280px;overflow:auto">${jsonHL(buildCmdb(req, rg))}</pre></div></div></div>`;
    }
    return "";
  }

  function resourcePlanCard(r) {
    const k = KIND[r.kind] || { icon: "box", color: "amber", label: r.kind };
    const params = Object.keys(r.params || {}).map((key) => `<span class="tag"><span class="k">${key}</span> ${esc(r.params[key])}</span>`).join(" ");
    const tags = Object.keys(r.tags || {}).map((key) => `<span class="tag"><span class="k">${key}</span> ${esc(r.tags[key])}</span>`).join(" ");
    const cites = (r.citations || []).map((c) => `<span class="cite">${ICON("file-text")}${esc(c)}</span>`).join(" ");
    return `<div class="res-card"><div class="rc-head"><div class="rc-ico ${bgClass[k.color]}">${ICON(k.icon)}</div><div><div class="rc-name">${esc(r.naming)}</div><div class="rc-kind">${k.label}</div></div><div class="rc-cost"><div class="v">${money(r.estimated_monthly_usd)}</div><div class="l">per month</div></div></div>
      <div class="rc-body"><div class="dim mono" style="font-size:11.5px;margin-bottom:8px">${esc(r.avm_module || r.module || "")}</div><div class="center wrap gap-6" style="margin-bottom:8px">${params}</div><div class="center wrap gap-6">${tags}</div><div class="divider" style="margin:10px 0"></div><div class="dim" style="font-size:11px;margin-bottom:6px">Grounded by</div><div class="center wrap gap-6">${cites}</div></div></div>`;
  }
  function approveDetail(req, st) {
    const total = (req.resources || []).reduce((a, r) => a + (r.estimated_monthly_usd || 0), 0);
    if (st === "done" || st === "error") { const ok = st === "done"; return `<div class="panel"><div class="center gap-10">${ICON(ok ? "user-check" : "x-circle")}<div><strong>${ok ? "Approved" : "Rejected"} by ${esc(req.approver || "Bob Carver")}</strong><div class="dim">${ok ? "Approval recorded · deployment triggered" : "No deployment performed"}</div></div></div></div>`; }
    const card = `<div class="adaptive"><div class="ac-top"><div class="ac-logo">T</div><div><div class="ac-title">Self-Service Provisioning</div><div class="ac-sub">Approval requested · ${esc(req.id)}</div></div></div>
      <div class="ac-body"><dl class="kv"><dt>Requester</dt><dd>${esc(req.requesterName)} · ${esc(req.team)}</dd><dt>Environment</dt><dd>${esc(req.environment)}</dd><dt>Resources</dt><dd>${(req.resources || []).map((r) => esc(r.naming)).join("<br>")}</dd><dt>Governance</dt><dd><span class="badge success">${ICON("check")}Validated</span></dd><dt>Est. cost</dt><dd><strong>${money(total)}/mo</strong></dd></dl></div>
      <div class="ac-actions">${isAdmin() ? `<button class="btn success" data-app="${req.id}" style="flex:1">${ICON("check")}Approve</button><button class="btn danger" data-rej="${req.id}" style="flex:1">${ICON("x")}Reject</button>` : `<div class="dim center gap-8" style="flex:1;justify-content:center">${ICON("clock")}Awaiting Bob Carver (Admin)</div>`}</div></div>`;
    const note = !isAdmin() ? `<div class="dim mt-12 center gap-8">${ICON("info")}Switch to the <strong style="color:var(--ink)">Admin</strong> view (bottom-left) to approve.</div>` : "";
    return `<div class="panel" style="background:transparent;border:0;padding:0">${card}${note}</div>`;
  }
  function buildPlanJson(req) {
    return { request_id: req.id, requester: req.requester, environment: req.environment, owner_team: req.team,
      resources: (req.resources || []).map((r) => ({ logical_name: r.logical_name, kind: r.kind, module: r.avm_module || r.module, params: r.params, naming: r.naming, tags: r.tags, estimated_monthly_usd: r.estimated_monthly_usd, citations: r.citations })),
      total_estimated_monthly_usd: Math.round((req.resources || []).reduce((a, r) => a + (r.estimated_monthly_usd || 0), 0) * 100) / 100 };
  }
  function buildCmdb(req, rg) {
    return { request_id: req.id, requester: req.requester, team: req.team, env: req.environment, resource_group: rg,
      resources: (req.resources || []).map((r) => ({ id: (r.azure_ids || [])[0] || r.naming, kind: r.kind, name: r.naming,
        endpoint: r.kind === "storage_account" ? `https://${r.naming}.blob.core.windows.net/` : undefined, tags: r.tags })),
      deployed_at: req.completed, approver: req.approver, cost_estimate_monthly_usd: (req.resources || []).reduce((a, r) => a + (r.estimated_monthly_usd || 0), 0) };
  }

  // ============================================================ REQUESTS / APPROVALS
  async function viewRequests() {
    await loadRequests();
    const reqs = STATE.requests;
    const rows = reqs.map(requestRow).join("") || `<tr><td colspan="8"><div class="empty" style="padding:30px"><div class="e-ico">${ICON("inbox")}</div><h3>No requests</h3><p><a href="#/request/new">Create one</a>.</p></div></td></tr>`;
    setView(`<div class="page-head"><div class="ph-text"><h1>Requests</h1><p class="sub">Every self-service request, its grounded plan and deployment outcome.</p></div><div class="ph-actions"><a class="btn primary" href="#/request/new">${ICON("plus")}New Request</a></div></div>
      <div class="card"><div class="card-head"><h3>All requests</h3><div style="flex:1"></div><span class="ch-sub">${reqs.length} total</span></div><div class="table-wrap"><table class="tbl"><thead><tr><th>Request</th><th>Summary</th><th>Env</th><th>Resources</th><th>Est. cost</th><th>Status</th><th>Created</th></tr></thead><tbody>${rows}</tbody></table></div></div>`);
    wireGo();
  }
  function requestRow(r) {
    const cost = (r.resources || []).reduce((a, x) => a + (x.estimated_monthly_usd || 0), 0);
    return `<tr class="clickable" data-go="#/request/${r.id}"><td class="mono strong">${r.id}</td><td style="max-width:280px">${esc(truncate(r.text, 56))}</td><td><span class="tag">${esc(r.environment || "dev")}</span></td><td>${(r.resources || []).length || "—"}</td><td class="mono">${cost ? money(cost) : "—"}</td><td>${statusBadge(r.status)}${r.status === "deployed" && r.expires_at ? `<div class="dim" style="font-size:10.5px;margin-top:3px">expires in ${ttlText(r.expires_at)}</div>` : ""}</td><td class="mono" style="white-space:nowrap">${fmtDate(r.created).split(" · ")[0]}</td></tr>`;
  }
  async function viewApprovals() {
    await loadRequests();
    const pend = STATE.requests.filter((r) => r.status === "awaiting_approval");
    const banner = !isAdmin() ? `<div class="card pad" style="background:var(--warning-soft);border-color:#f5dca8;display:flex;gap:12px;align-items:center;margin-bottom:18px"><div class="kpi-ico bg-amber">${ICON("info")}</div><div style="flex:1"><strong>You are viewing as a Requester.</strong><div class="dim">Switch to the <strong>Admin</strong> view (bottom-left) to approve or reject.</div></div><button class="btn" id="beAdmin">${ICON("user-check")}Switch to Admin</button></div>` : "";
    const cards = pend.length ? pend.map(approvalCard).join("") : `<div class="empty"><div class="e-ico">${ICON("check-circle")}</div><h3>No pending approvals</h3><p>Submitted requests awaiting a decision appear here.</p></div>`;
    setView(`<div class="page-head"><div class="ph-text"><h1>Approvals</h1><p class="sub">The human gate. Each card mirrors the Teams Adaptive Card — request, plan, validation and cost.</p></div><div class="ph-actions"><span class="badge warning">${ICON("clock")}${pend.length} pending</span></div></div>${banner}<div class="grid cols-2" style="align-items:start">${cards}</div>`);
    wireGo();
    $$("[data-app]").forEach((b) => b.addEventListener("click", async (e) => { e.stopPropagation(); await API.approve(b.dataset.app); location.hash = "/request/" + b.dataset.app; }));
    $$("[data-rej]").forEach((b) => b.addEventListener("click", async (e) => { e.stopPropagation(); await API.reject(b.dataset.rej); await viewApprovals(); }));
    const ba = $("#beAdmin"); if (ba) ba.addEventListener("click", () => { STATE.role = "bob"; localStorage.setItem("ssp_role", "bob"); mountShell(); viewApprovals(); });
  }
  function approvalCard(r) {
    const cost = (r.resources || []).reduce((a, x) => a + (x.estimated_monthly_usd || 0), 0);
    const resList = (r.resources || []).map((x) => `<span class="badge teal">${esc(x.naming)}</span>`).join(" ");
    return `<div class="card" style="cursor:pointer" data-go="#/request/${r.id}"><div class="card-head"><div class="kpi-ico bg-amber" style="width:34px;height:34px">${ICON("clock")}</div><div><h3 style="font-size:14px">${esc(r.id)}</h3><div class="ch-sub">${esc(r.requesterName)} · ${esc(r.team)} · ${fmtDate(r.created)}</div></div><div class="ch-actions">${statusBadge(r.status)}</div></div>
      <div class="card-body"><div style="font-size:13.5px;color:var(--ink);margin-bottom:12px">${esc(r.text)}</div><div class="center wrap gap-6" style="margin-bottom:12px">${resList}</div><dl class="kv" style="grid-template-columns:120px 1fr"><dt>Environment</dt><dd>${esc(r.environment)}</dd><dt>Governance</dt><dd><span class="badge success">${ICON("check")}Validated</span></dd><dt>Est. cost</dt><dd><strong>${money(cost)}/mo</strong></dd></dl></div>
      <div class="adaptive" style="border:0;box-shadow:none;max-width:none"><div class="ac-actions" style="border-top:1px solid var(--border)">${isAdmin() ? `<button class="btn success" data-app="${r.id}" style="flex:1">${ICON("check")}Approve &amp; deploy</button><button class="btn danger" data-rej="${r.id}" style="flex:1">${ICON("x")}Reject</button>` : `<div class="dim center gap-8" style="flex:1;justify-content:center;padding:4px">${ICON("lock")}Switch to Admin to act</div>`}</div></div></div>`;
  }

  // ============================================================ RESOURCES (CMDB)
  async function viewResources() {
    const rows = await API.resources();
    const rg = (STATE.config && STATE.config.resource_group) || "rg-selfservice-lz";
    const totalCost = rows.reduce((a, x) => a + (x.estimated_monthly_usd || 0), 0);
    const strip = `<div class="stat-strip" style="margin-bottom:20px"><div class="st"><div class="v">${rows.length}</div><div class="l">Live resources</div></div><div class="st"><div class="v">${rows.length ? money0(totalCost) : "$0"}</div><div class="l">Monthly run-rate</div></div><div class="st"><div class="v">100%</div><div class="l">Tag compliance</div></div><div class="st"><div class="v">${esc((STATE.config && STATE.config.mode) || "offline")}</div><div class="l">Source</div></div></div>`;
    const trows = rows.map((r) => { const tags = Object.keys(r.tags || {}).map((t) => `<span class="tag"><span class="k">${t}</span> ${esc(r.tags[t])}</span>`).join(" "); const sub = r.endpoint ? esc(r.endpoint) : esc((r.type || "").split("/").pop()); return `<tr><td><div class="center gap-10"><div class="li-ico bg-amber" style="width:30px;height:30px">${ICON("box")}</div><div><div class="strong mono" style="font-size:12.5px">${esc(r.name)}</div><div class="dim mono" style="font-size:10.5px">${sub}</div></div></div></td><td><span class="tag">${esc(r.location || "—")}</span></td><td><span class="tag">${esc((r.tags || {}).env || "—")}</span></td><td>${esc((r.tags || {}).owner || "—")}</td><td class="mono" style="font-size:11.5px;white-space:nowrap">${r.expires_at ? esc(ttlText(r.expires_at)) : "—"}</td><td><span class="badge success"><span class="bd"></span>Running</span></td></tr>`; }).join("")
      || `<tr><td colspan="6"><div class="empty" style="padding:30px"><div class="e-ico">${ICON("cloud")}</div><h3>Landing zone is empty</h3><p>Approve a request to provision a resource.</p></div></td></tr>`;
    setView(`<div class="page-head"><div class="ph-text"><h1>Landing zone &amp; CMDB</h1><p class="sub">Live inventory in <span class="mono">${esc(rg)}</span>${(STATE.config && STATE.config.mode) === "azure-live" ? ", sourced from Azure Resource Graph" : " (local record — Resource Graph when Azure is configured)"}.</p></div></div>${strip}
      <div class="card"><div class="card-head"><h3>Provisioned resources</h3><span class="ch-sub">${rows.length} records</span></div><div class="table-wrap"><table class="tbl"><thead><tr><th>Resource</th><th>Region</th><th>Env</th><th>Owner</th><th>Expires</th><th>State</th></tr></thead><tbody>${trows}</tbody></table></div></div>`);
  }

  // ============================================================ GOVERNANCE
  function viewGovernance() {
    const P = REF.POLICY, R = REF.RBAC;
    const gates = [
      { icon: "shield", bg: "bg-blue", name: "Azure Policy", by: "Machine gate", desc: "Allowed locations & SKUs, required tags, HTTPS-only. The deny effect blocks non-compliant resources before deploy.", badge: "Assigned at sandbox RG scope" },
      { icon: "lock", bg: "bg-violet", name: "RBAC + scope", by: "Machine gate", desc: "Requesters never write resources. The deploying principal is Contributor scoped to a single sandbox resource group — least privilege.", badge: "Least privilege · single RG" },
      { icon: "user-check", bg: "bg-green", name: "Human approval", by: "Human gate", desc: "A reviewer approves the plan, citations, validation and cost. No deployment runs without it.", badge: "Approve / Reject" },
    ].map((g) => `<div class="card gate"><div class="g-ico ${g.bg}">${ICON(g.icon)}</div><div><div class="center gap-8"><h4>${g.name}</h4><span class="badge outline">${g.by}</span></div></div><div class="g-desc">${g.desc}</div><div><span class="badge neutral">${g.badge}</span></div></div>`).join("");
    const rows = P.rules.map((r) => `<tr><td class="strong">${esc(r.name)}</td><td class="dim">${esc(r.desc)}</td><td><span class="badge ${r.effect === "Deny" ? "danger" : "neutral"}">${r.effect}</span></td><td><span class="badge ${r.compliant ? "success" : "warning"}">${ICON(r.compliant ? "check" : "alert-triangle")}${r.compliant ? "Active" : "Review"}</span></td></tr>`).join("");
    setView(`<div class="page-head"><div class="ph-text"><h1>Governance</h1><p class="sub">Defense in depth. The agent proposes; the platform disposes — it never deploys directly.</p></div></div>
      <div class="section-title">Three-gate governance model</div><div class="grid cols-3">${gates}</div>
      <div class="grid cols-3 mt-20" style="grid-template-columns:2fr 1fr">
        <div class="card"><div class="card-head"><h3>Policy guardrails</h3><span class="ch-sub">${esc(P.initiative)}</span></div><div class="table-wrap"><table class="tbl"><thead><tr><th>Policy</th><th>Definition</th><th>Effect</th><th>State</th></tr></thead><tbody>${rows}</tbody></table></div>
          <div class="card-body dim" style="font-size:12px">In v1 these guardrails are shown and validated; assigning the Azure Policy initiative to the sandbox RG turns them into a real, enforced deny path (next iteration).</div></div>
        <div class="card"><div class="card-head"><div class="kpi-ico bg-violet" style="width:34px;height:34px">${ICON("lock")}</div><h3>RBAC &amp; scope</h3></div><div class="card-body"><div class="section-title">${esc(R.customRole)}</div><div class="list">${R.permissions.map((p) => `<div class="li"><div class="li-ico bg-slate" style="width:30px;height:30px">${ICON("check")}</div><div class="li-main"><div class="li-sub" style="color:var(--ink-2)">${esc(p)}</div></div></div>`).join("")}</div><div class="divider"></div><dl class="kv"><dt>Principal</dt><dd class="mono">${esc(R.pim.principal)}</dd><dt>Scope</dt><dd>${esc(R.pim.role)}</dd></dl></div></div>
      </div>`);
  }

  // ============================================================ CATALOG
  async function viewCatalog() {
    const data = await API.standards();
    const stds = (data.standards || []).map((s) => `<div class="card"><div class="card-head"><div class="kpi-ico bg-violet" style="width:34px;height:34px">${ICON(s.icon || "file-text")}</div><div><h3 style="font-size:14px">${esc(s.title)}</h3><div class="ch-sub mono">${esc(s.file)}</div></div></div><div class="card-body"><p style="font-size:13px;color:var(--ink-2);margin-bottom:12px">${esc(s.summary)}</p><table class="tbl" style="font-size:12.5px">${s.body.map((row) => `<tr><td class="strong" style="width:40%;padding:8px 0;border-color:var(--border)">${esc(row[0])}</td><td class="mono" style="padding:8px 0;border-color:var(--border)">${esc(row[1])}</td></tr>`).join("")}</table><div class="dim mt-12" style="font-size:11px">Updated ${esc(s.updated)}</div></div></div>`).join("");
    const cat = (data.catalog || []).map((a) => `<div class="card"><div class="card-head"><div class="kpi-ico bg-amber" style="width:34px;height:34px">${ICON(a.icon || "box")}</div><div><h3 style="font-size:14px">${esc(a.title)}</h3><div class="ch-sub mono">${esc(a.id)}</div></div><div class="ch-actions"><span class="badge outline">${esc(a.version)}</span></div></div><div class="card-body"><p style="font-size:13px;color:var(--ink-2);margin-bottom:10px">${esc(a.purpose)}</p><div class="dim mono" style="font-size:11.5px;margin-bottom:10px">${esc(a.module)}</div><div class="section-title">Required params</div><div class="center wrap gap-6" style="margin-bottom:12px">${a.required.map((p) => `<span class="tag">${esc(p)}</span>`).join(" ")}</div><div class="section-title">Example</div><pre class="code" style="font-size:11.5px">${jsonHL(a.example)}</pre></div></div>`).join("");
    setView(`<div class="page-head"><div class="ph-text"><h1>Standards &amp; catalog</h1><p class="sub">The RAG knowledge base. The agent retrieves from these documents and composes plans only from this catalogue — it never invents a SKU, region or tag.</p></div></div>
      <div class="card pad" style="display:flex;gap:14px;align-items:center;margin-bottom:22px;background:linear-gradient(180deg,var(--surface),var(--surface-2))"><div class="kpi-ico bg-violet">${ICON("book")}</div><div style="flex:1"><strong>Grounding source</strong><div class="dim">${(data.standards || []).length} standards documents · ${(data.catalog || []).length} catalogue module(s). ${(STATE.config && STATE.config.mode) === "offline" ? "Retrieved by keyword scoring (offline)." : "Embedded with text-embedding-3-small and retrieved by cosine similarity."}</div></div></div>
      <div class="tabs" data-tabs style="margin-bottom:18px"><button class="on" data-tab="std">Standards corpus</button><button data-tab="cat">Catalogue</button></div>
      <div data-tabpane="std"><div class="grid cols-2" style="align-items:start">${stds}</div></div>
      <div data-tabpane="cat" style="display:none"><div class="grid cols-2" style="align-items:start">${cat}</div></div>`);
    wireTabs();
  }

  // ---------- tabs ----------
  function wireTabs(root) {
    $$("[data-tabs]", root || document).forEach((tb) => {
      const scope = tb.parentNode;
      $$("button", tb).forEach((btn) => btn.addEventListener("click", () => {
        $$("button", tb).forEach((b) => b.classList.remove("on")); btn.classList.add("on");
        const name = btn.dataset.tab;
        $$("[data-tabpane]", scope).forEach((p) => { p.style.display = p.dataset.tabpane === name ? "" : "none"; });
      }));
    });
  }

  // ---------- JSON highlight ----------
  function jsonHL(obj) {
    let json = JSON.stringify(obj, null, 2).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+\-]?\d+)?)/g, (m) => {
      let cls = "c-num"; if (/^"/.test(m)) cls = /:$/.test(m) ? "c-key" : "c-str"; else if (/true|false|null/.test(m)) cls = "c-kw"; return `<span class="${cls}">${m}</span>`;
    });
  }

  // ============================================================ CHAT WIDGET
  const CHAT = { open: false, hist: [], busy: false };
  function mountChat() {
    if ($("#chatPanel")) return;
    const fab = document.createElement("button");
    fab.id = "chatFab"; fab.className = "chat-fab"; fab.innerHTML = ICON("message") + "Assistant";
    document.body.appendChild(fab);
    const panel = document.createElement("div");
    panel.id = "chatPanel"; panel.className = "chat-panel hidden";
    panel.innerHTML = `
      <div class="cp-head"><div class="cp-title">${ICON("message")}Provisioning Assistant</div><button class="icon-btn" id="chatClose">${ICON("x")}</button></div>
      <div class="cp-body" id="chatBody"></div>
      <div class="cp-suggest" id="chatSuggest"></div>
      <div class="cp-input"><input id="chatInput" placeholder="Ask how to use the system…" autocomplete="off"><button class="btn primary sm" id="chatSend">${ICON("send")}</button></div>`;
    document.body.appendChild(panel);
    fab.addEventListener("click", () => toggleChat(true));
    $("#chatClose").addEventListener("click", () => toggleChat(false));
    $("#chatSend").addEventListener("click", sendChat);
    $("#chatInput").addEventListener("keydown", (e) => { if (e.key === "Enter") sendChat(); });
    const qs = ["How do I create a request?", "What can I provision?", "How long do resources last?", "How does approval work?"];
    $("#chatSuggest").innerHTML = qs.map((q) => `<button data-q="${esc(q)}">${esc(q)}</button>`).join("");
    $$("#chatSuggest button").forEach((b) => b.addEventListener("click", () => { $("#chatInput").value = b.dataset.q; sendChat(); }));
    pushBubble("bot", "Hi! I'm your provisioning assistant. Ask me how to create a request, what you can provision, or how auto-delete works.");
  }
  function toggleChat(open) { CHAT.open = open; $("#chatPanel").classList.toggle("hidden", !open); $("#chatFab").classList.toggle("hidden", open); if (open) setTimeout(() => $("#chatInput").focus(), 50); }
  function pushBubble(role, text) {
    const body = $("#chatBody"); const row = document.createElement("div"); row.className = "msg-row " + (role === "me" ? "me" : "bot");
    row.innerHTML = role === "me" ? `<div class="bubble">${esc(text)}</div>`
      : `<div class="msg-av bot">AI</div><div class="bubble"><div class="who">Assistant</div>${esc(text).replace(/\n/g, "<br>")}</div>`;
    body.appendChild(row); body.scrollTop = body.scrollHeight;
  }
  async function sendChat() {
    const inp = $("#chatInput"); const msg = (inp.value || "").trim(); if (!msg || CHAT.busy) return;
    inp.value = ""; pushBubble("me", msg);
    CHAT.busy = true; const body = $("#chatBody");
    const typing = document.createElement("div"); typing.className = "cp-typing"; typing.textContent = "Assistant is typing…";
    body.appendChild(typing); body.scrollTop = body.scrollHeight;
    try {
      const res = await API.chat(msg, CHAT.hist.slice());
      typing.remove(); pushBubble("bot", res.reply);
      CHAT.hist.push({ role: "user", content: msg }, { role: "assistant", content: res.reply });
      if (CHAT.hist.length > 16) CHAT.hist = CHAT.hist.slice(-16);
    } catch (e) { typing.remove(); pushBubble("bot", "Sorry, I couldn't reach the assistant just now."); }
    CHAT.busy = false;
  }

  // ============================================================ BOOT
  window.addEventListener("hashchange", () => router());
  document.addEventListener("DOMContentLoaded", async () => {
    try { STATE.config = await API.config(); } catch (e) { STATE.config = { mode: "offline" }; }
    const chip = $("#mode-chip"); if (chip) { const m = STATE.config.mode || "offline"; chip.textContent = ({ offline: "Offline (simulated)", "llm-live": "Semi-simulation (real AI)", "azure-live": "Live Azure" })[m] || m; }
    try { await loadRequests(); } catch (e) {}
    router();
    mountChat();
    if (/[?&]chat=1/.test(location.search)) setTimeout(() => toggleChat(true), 200);
  });
})();
