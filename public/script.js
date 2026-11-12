const $ = (id) => document.getElementById(id);
const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
  : "k-" + Date.now().toString(36) + Math.random().toString(36).slice(2));

let selected = null;                 // the slot object the patient picked
let idem = { key: null, sig: null }; // one Idempotency-Key per distinct booking request
let nextCursor = null, listedEmail = "";
let busy = false;
let allSlots = [];

function show(id, text, kind){ const el = $(id); el.textContent = text || ""; el.className = "msg " + (kind || ""); }

// One place that talks to the backend. The server adds the X-API-Key header
// (from process.env.API_KEY) on the /api mount, so no key is handled here.
async function api(method, path, body, headers = {}) {
  try {
    const res = await fetch("/api" + path, {
      method,
      headers: { ...(body ? { "Content-Type":"application/json" } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch {}
    return { ok:res.ok, status:res.status, data: data || {}, retryAfter: res.headers.get("Retry-After") };
  } catch {
    return { ok:false, status:0, data:{ error:"Can't reach the server. Check your connection and try again." } };
  }
}

function errorText(r){
  if (r.status === 401) return "The service is misconfigured. Please contact the clinic.";
  if (r.status === 429) return `Too many attempts for this email. Try again in ${r.retryAfter || "a few"} seconds.`;
  return (r.data && r.data.error) || "Something went wrong. Try again.";
}

// Themed confirmation dialog (replaces window.confirm). Resolves true/false.
function confirmDialog({ title, text, yes = "Confirm", no = "Go back" }) {
  return new Promise((resolve) => {
    const d = $("confirmDlg");
    $("dlgTitle").textContent = title;
    $("dlgText").textContent = text;
    $("dlgOk").textContent = yes;
    $("dlgNo").textContent = no;
    d.returnValue = "";
    d.addEventListener("close", () => resolve(d.returnValue === "ok"), { once: true });
    d.showModal();
  });
}
// clicking the backdrop closes it (counts as "no")
$("confirmDlg").addEventListener("click", (e) => {
  if (e.target === e.currentTarget) e.currentTarget.close();
});

const fmtDay  = (d) => d.toLocaleDateString(undefined, { weekday:"long", day:"numeric", month:"long", year:"numeric" });
const fmtTime = (d) => d.toLocaleTimeString(undefined, { hour:"numeric", minute:"2-digit" });
const fmtFull = (iso) => { const d = new Date(iso); return isNaN(d) ? iso : `${fmtDay(d)}, ${fmtTime(d)}`; };

// ---------- 1. slots ----------
async function loadSlots(){
  show("slotsMsg", "Loading slots…");
  const p = $("provider").value.trim();
  const r = await api("GET", "/slots" + (p ? "?provider=" + encodeURIComponent(p) : ""));
  if (!r.ok) { show("slotsMsg", errorText(r), "err"); return; }
  allSlots = r.data.slots || [];
  show("slotsMsg", "");
  if (selected && !allSlots.some(s => s.id === selected.id && s.available)) pick(null);
  renderSlots();
}

function renderSlots(){
  const box = $("slots"); box.innerHTML = "";
  const now = Date.now();
  const list = allSlots.filter(s => !$("onlyFree").checked || (s.available && new Date(s.start) > now));
  if (!list.length) {
    show("slotsMsg", allSlots.length ? "No free slots right now." : "No slots yet. Add some under “Set up your data”.", "warn");
    return;
  }
  show("slotsMsg", "");
  let day = "", grid;
  for (const s of list) {
    const d = new Date(s.start), label = fmtDay(d);
    if (label !== day) {
      day = label;
      const h = document.createElement("div"); h.className = "day"; h.textContent = label; box.appendChild(h);
      grid = document.createElement("div"); grid.className = "slots"; box.appendChild(grid);
    }
    const past = d <= now, free = s.available && !past;
    const b = document.createElement("button");
    b.type = "button"; b.className = "slot"; b.disabled = !free;
    b.setAttribute("aria-pressed", selected && selected.id === s.id ? "true" : "false");
    const t = document.createElement("span"); t.textContent = fmtTime(d);
    const small = document.createElement("small"); small.textContent = s.provider + (free ? "" : past ? " (past)" : " (booked)");
    b.append(t, small);
    b.addEventListener("click", () => pick(s));
    grid.appendChild(b);
  }
}

function pick(s){
  selected = s;
  const c = $("chosen");
  c.hidden = !s;
  if (s) c.textContent = `${s.provider}, ${fmtFull(s.start)}`;
  $("bookBtn").disabled = !s;
  show("bookMsg", "");
  renderSlots();
}

// ---------- 2. book ----------
async function book(){
  if (busy || !selected) return;
  const name = $("name").value.trim(), email = $("email").value.trim();
  if (!name) return show("bookMsg", "Enter your full name.", "err");
  if (!/^\S+@\S+\.\S+$/.test(email)) return show("bookMsg", "Enter a valid email address.", "err");

  const body = { slot_id: selected.id, name, email };
  // Same details => same key, so a retry after a dropped connection can't double-book.
  const sig = JSON.stringify(body);
  if (idem.sig !== sig) idem = { key: uuid(), sig };

  busy = true; $("bookBtn").disabled = true; show("bookMsg", "Booking…");
  const r = await api("POST", "/bookings", body, { "Idempotency-Key": idem.key });
  busy = false; $("bookBtn").disabled = false;

  if (r.status === 201 || (r.ok && r.data && r.data.id)) {
    show("bookMsg", "You're booked. Keep your booking ID to cancel or look it up later.", "ok");
    $("confirmation").innerHTML = "";
    $("confirmation").appendChild(bookingCard(r.data, { confirmation:true }));
    $("lookupEmail").value = email;
    idem = { key:null, sig:null };
    pick(null); loadSlots();
  } else if (r.status === 409) {
    show("bookMsg", "Someone else just booked that slot. Pick another time.", "warn");
    idem = { key:null, sig:null }; pick(null); loadSlots();
  } else if (r.status === 404) {
    show("bookMsg", "That slot no longer exists. Pick another time.", "warn"); pick(null); loadSlots();
  } else {
    show("bookMsg", errorText(r), r.status === 429 ? "warn" : "err");
  }
}

function bookingCard(b, opts = {}){
  const card = document.createElement("div");
  card.className = "card" + (opts.confirmation ? " confirmation" : "");
  const dl = document.createElement("dl");
  const slot = allSlots.find(s => s.id === b.slot_id);
  const rows = [
    ["Status", null],
    ["Booking ID", b.id],
    ["Slot", slot ? `${slot.provider}, ${fmtFull(slot.start)}` : b.slot_id],
    ["Name", b.name], ["Email", b.email],
    ["Booked at", fmtFull(b.created_at)],
  ];
  for (const [k, v] of rows) {
    const dt = document.createElement("dt"); dt.textContent = k;
    const dd = document.createElement("dd");
    if (k === "Status") { const t = document.createElement("span"); t.className = "tag " + b.status; t.textContent = b.status; dd.appendChild(t); }
    else dd.textContent = v;
    dl.append(dt, dd);
  }
  card.appendChild(dl);
  if (b.status === "confirmed") {
    const x = document.createElement("button");
    x.type = "button"; x.className = "danger"; x.textContent = "Cancel booking";
    x.addEventListener("click", () => cancel(b.id, card));
    card.appendChild(x);
  }
  return card;
}

// ---------- 3. find / cancel ----------
async function listBookings(more){
  const email = more ? listedEmail : $("lookupEmail").value.trim();
  if (!email) return show("mineMsg", "Enter the email you booked with.", "err");
  if (!more) { $("mine").innerHTML = ""; listedEmail = email; nextCursor = null; }
  show("mineMsg", "Loading…");
  const qs = new URLSearchParams({ email, limit: "5" });
  if (more && nextCursor) qs.set("cursor", nextCursor);
  const r = await api("GET", "/bookings?" + qs);
  if (!r.ok) return show("mineMsg", errorText(r), "err");
  const items = r.data.bookings || [];
  for (const b of items) $("mine").appendChild(bookingCard(b));
  nextCursor = r.data.next_cursor || null;
  $("moreBtn").hidden = !nextCursor;
  show("mineMsg", $("mine").children.length ? "" : "No bookings found for that email.", $("mine").children.length ? "" : "warn");
}

async function getBooking(){
  const id = $("lookupId").value.trim();
  if (!id) return show("mineMsg", "Enter a booking ID.", "err");
  const r = await api("GET", "/bookings/" + encodeURIComponent(id));
  $("mine").innerHTML = ""; $("moreBtn").hidden = true;
  if (r.status === 404) return show("mineMsg", "No booking with that ID.", "warn");
  if (!r.ok) return show("mineMsg", errorText(r), "err");
  show("mineMsg", ""); $("mine").appendChild(bookingCard(r.data));
}

async function cancel(id, card){
  const ok = await confirmDialog({
    title: "Cancel this booking?",
    text: "The slot will be freed for other patients.",
    yes: "Cancel booking",
    no: "Keep booking",
  });
  if (!ok) return;

  const btn = card.querySelector("button.danger");
  if (btn) { btn.disabled = true; btn.textContent = "Cancelling…"; }

  const r = await api("DELETE", "/bookings/" + encodeURIComponent(id));
  if (r.status === 409) show("mineMsg", "That booking was already cancelled.", "warn");
  else if (r.status === 404) show("mineMsg", "That booking no longer exists.", "warn");
  else if (!r.ok) {
    if (btn) { btn.disabled = false; btn.textContent = "Cancel booking"; }
    return show("mineMsg", errorText(r), "err");
  }
  else show("mineMsg", "Booking cancelled. The slot is free again.", "ok");
  if (r.ok) { card.replaceWith(bookingCard(r.data)); loadSlots(); }
}

// ---------- setup ----------
async function addSlots(){
  const provider = $("sProvider").value.trim(), start = $("sStart").value;
  const mins = Number($("sMins").value), count = Number($("sCount").value);
  if (!provider || !start) return show("setupMsg", "Enter a provider and a start time.", "err");
  if (!(mins >= 1) || !(count >= 1 && count <= 200)) return show("setupMsg", "Minutes must be 1 or more, and slots between 1 and 200.", "err");
  const t0 = new Date(start).getTime();
  const slots = Array.from({ length: count }, (_, i) => ({
    provider,
    start: new Date(t0 + i * mins * 60000).toISOString(),
    end:   new Date(t0 + (i + 1) * mins * 60000).toISOString(),
  }));
  const r = await api("POST", "/slots", { slots });
  if (!r.ok) return show("setupMsg", errorText(r), "err");
  show("setupMsg", `Added ${slots.length} slots.`, "ok"); loadSlots();
}

async function wipe(){
  const ok = await confirmDialog({
    title: "Delete everything?",
    text: "This removes ALL slots and ALL bookings and can't be undone.",
    yes: "Delete everything",
    no: "Keep data",
  });
  if (!ok) return;
  const r = await api("POST", "/reset", { slots: [] });
  if (!r.ok) return show("setupMsg", errorText(r), "err");
  show("setupMsg", "Everything deleted.", "ok");
  $("confirmation").innerHTML = ""; $("mine").innerHTML = ""; pick(null); loadSlots();
}

// ---------- wire up ----------
$("loadSlots").addEventListener("click", loadSlots);
$("onlyFree").addEventListener("change", renderSlots);
$("bookBtn").addEventListener("click", book);
$("listBtn").addEventListener("click", () => listBookings(false));
$("moreBtn").addEventListener("click", () => listBookings(true));
$("getBtn").addEventListener("click", getBooking);
$("addSlots").addEventListener("click", addSlots);
$("wipe").addEventListener("click", wipe);
loadSlots();