/* panel.js (CZYSTY JS) */
const sb = window.supabaseClient;

const loginBox = document.getElementById("loginBox");
const panelBox = document.getElementById("panelBox");
const userInfo = document.getElementById("userInfo");
const loginMsg = document.getElementById("loginMsg");

const createMsg = document.getElementById("createMsg");
const useMsg = document.getElementById("useMsg");

const listTbody = document.getElementById("list");
const filterStatusEl = document.getElementById("filterStatus");
const checkAllEl = document.getElementById("checkAll");
const deleteSelectedBtn = document.getElementById("deleteSelectedBtn");

let currentUserEmail = "";
let selected = new Map(); // key: "v:<uuid>" or "o:<uuid>" => { type, id }

function esc(s){
  return String(s ?? "")
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#39;");
}

function fmtDate(iso){
  try{ return new Date(iso).toLocaleString("pl-PL"); }
  catch{ return iso || "—"; }
}

function isUuid(v){
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(v||""));
}

function normCode(v){
  return String(v || "").trim().toUpperCase();
}

function genShortCode(){
  const alphabet = "ABCDEFGHJKMNPQRSTUVWX YZ23456789".replaceAll(" ","");
  let out = "JL-";
  for(let i=0;i<6;i++){
    out += alphabet[Math.floor(Math.random()*alphabet.length)];
  }
  return out;
}

function currentVoucherLink(id){
  return `${location.origin}/client/voucher.html?id=${encodeURIComponent(id)}`;
}

function setMsg(el, text, kind=""){
  el.className = "msg " + (kind ? kind : "");
  el.textContent = text || "";
}

/* ================= AUTH ================= */

async function checkAuth(){
  const { data:{ session }, error } = await sb.auth.getSession();
  if(error){
    console.warn(error);
  }

  if(session){
    currentUserEmail = session.user?.email || "";
    loginBox.style.display = "none";
    panelBox.style.display = "block";
    userInfo.textContent = currentUserEmail;
    await loadAll();
  }else{
    loginBox.style.display = "block";
    panelBox.style.display = "none";
    userInfo.textContent = "";
  }
}

window.login = async function login(){
  loginMsg.textContent = "";
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  if(!email || !password){
    loginMsg.textContent = "Podaj email i hasło.";
    return;
  }

  const { error } = await sb.auth.signInWithPassword({ email, password });
  if(error){
    loginMsg.textContent = error.message;
    return;
  }

  await checkAuth();
};

window.register = async function register(){
  loginMsg.textContent = "";
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  if(!email || !password){
    loginMsg.textContent = "Podaj email i hasło.";
    return;
  }

  const { error } = await sb.auth.signUp({ email, password });
  if(error){
    loginMsg.textContent = error.message;
    return;
  }

  loginMsg.textContent = "Konto utworzone – zaloguj się";
};

window.logout = async function logout(){
  await sb.auth.signOut();
  location.reload();
};

/* ================= CREATE (admin) ================= */

window.clearCreate = function clearCreate(){
  document.getElementById("v_amount").value = "";
  document.getElementById("v_name").value = "";
  document.getElementById("v_email").value = "";
  setMsg(createMsg, "");
};

window.createVoucherNow = async function createVoucherNow(){
  setMsg(createMsg, "");

  const amount = document.getElementById("v_amount").value.trim();
  const name = document.getElementById("v_name").value.trim();
  const email = document.getElementById("v_email").value.trim();

  if(!amount){
    setMsg(createMsg, "Podaj kwotę.", "err");
    return;
  }

  // spróbuj wygenerować unikalny short_code (kilka prób)
  let shortCode = "";
  let lastErr = null;
  for(let i=0;i<8;i++){
    shortCode = genShortCode();
    const { data, error } = await sb
      .from("vouchers")
      .insert([{
        amount_text: amount,
        status: "active",
        recipient_name: name || null,
        recipient_email: email || null,
        buyer_email: currentUserEmail || null,
        short_code: shortCode
      }])
      .select("id, short_code")
      .single();

    if(!error && data){
      const link = currentVoucherLink(data.id);

      // skopiuj link
      try{ await navigator.clipboard.writeText(link); } catch {}

      setMsg(createMsg, `Utworzono voucher: ${data.short_code} — link skopiowany ✅`, "ok");
      await loadAll();
      return;
    }
    lastErr = error;
  }

  setMsg(createMsg, lastErr?.message || "Nie udało się utworzyć vouchera.", "err");
};

/* ================= ISSUE from ORDER (pending -> voucher) ================= */

window.issueVoucherFromOrder = async function issueVoucherFromOrder(orderId){
  if(!orderId) return;

  // 1) pobierz zamówienie
  const { data: order, error: e0 } = await sb
    .from("voucher_orders")
    .select("id, amount_text, status, recipient_name, recipient_email, buyer_email, voucher_id")
    .eq("id", orderId)
    .single();

  if(e0) return alert(e0.message);
  if(!order) return alert("Nie znaleziono zamówienia.");

  const st = String(order.status || "").toLowerCase();
  if(st === "paid" && order.voucher_id){
    alert("To zamówienie ma już wystawiony voucher.");
    return;
  }

  if(!order.amount_text){
    alert("Brak kwoty w zamówieniu (amount_text).");
    return;
  }

  // 2) utwórz voucher (kilka prób short_code)
  let shortCode = "";
  let lastErr = null;
  let voucher = null;

  for(let i=0;i<8;i++){
    shortCode = genShortCode();

    const { data, error } = await sb
      .from("vouchers")
      .insert([{
        order_id: order.id,
        amount_text: order.amount_text,
        status: "active",
        recipient_name: order.recipient_name || null,
        recipient_email: order.recipient_email || null,
        buyer_email: order.buyer_email || null,
        short_code: shortCode
      }])
      .select("id, short_code")
      .single();

    if(!error && data){
      voucher = data;
      break;
    }
    lastErr = error;
  }

  if(!voucher){
    alert(lastErr?.message || "Nie udało się utworzyć vouchera.");
    return;
  }

  // 3) zaktualizuj zamówienie -> paid + voucher_id
  const { error: e2 } = await sb
    .from("voucher_orders")
    .update({ status: "paid", voucher_id: voucher.id })
    .eq("id", order.id);

  if(e2){
    alert("Voucher utworzony, ale nie udało się zaktualizować zamówienia: " + e2.message);
  }

  // 4) skopiuj link + odśwież
  const link = currentVoucherLink(voucher.id);
  try{ await navigator.clipboard.writeText(link); } catch {}

  alert(`Wystawiono voucher: ${voucher.short_code || voucher.id}\nLink skopiowany ✅`);
  await loadAll();
};

/* ================= USE (mark USED) ================= */

window.clearUse = function clearUse(){
  document.getElementById("use_code").value = "";
  document.getElementById("use_note").value = "";
  setMsg(useMsg, "");
};

window.useVoucher = async function useVoucher(){
  setMsg(useMsg, "");

  const raw = document.getElementById("use_code").value.trim();
  const note = document.getElementById("use_note").value.trim();

  if(!raw){
    setMsg(useMsg, "Wpisz kod lub UUID.", "err");
    return;
  }

  const code = normCode(raw);

  // 1) znajdź voucher
  let q = sb.from("vouchers").select("id, status, short_code, amount_text, recipient_name, used_at").limit(1);

  if(isUuid(code)){
    q = q.eq("id", code);
  }else{
    // normalnie po short_code
    q = q.eq("short_code", code);
  }

  const { data, error } = await q.maybeSingle();
  if(error){
    setMsg(useMsg, error.message, "err");
    return;
  }
  if(!data){
    setMsg(useMsg, "Nie znaleziono vouchera.", "err");
    return;
  }

  // 2) walidacja
  const st = String(data.status || "").toLowerCase();
  if(st === "used"){
    setMsg(useMsg, `Ten voucher jest już USED (${data.short_code || data.id}).`, "warn");
    return;
  }

  // 3) update => USED
  const { error: e2 } = await sb
    .from("vouchers")
    .update({
      status: "used",
      used_at: new Date().toISOString(),
      used_note: note || null,
      used_by: currentUserEmail || null
    })
    .eq("id", data.id);

  if(e2){
    setMsg(useMsg, e2.message, "err");
    return;
  }

  setMsg(useMsg, `Oznaczono jako USED: ${data.short_code || data.id} ✅`, "ok");
  await loadAll();
};

/* ================= LIST: merge vouchers + orders ================= */

function resetSelection(){
  selected.clear();
  if(checkAllEl) checkAllEl.checked = false;
  if(deleteSelectedBtn) deleteSelectedBtn.disabled = true;
}

function updateDeleteBtnState(){
  if(deleteSelectedBtn) deleteSelectedBtn.disabled = selected.size === 0;
}

function makeActionLinks({ voucherId, shortCode }){
  const link = currentVoucherLink(voucherId);
  const sms = `sms:?&body=${encodeURIComponent("Twój voucher JL Pro Bike: " + link)}`;

  // ikony są robione CSS-em (.ico), dzięki temu nie znikają w różnych przeglądarkach
  return `
    <a class="aIcon" href="${esc(link)}" target="_blank" rel="noopener">
      <span class="ico ico-open"></span><span>Otwórz</span>
    </a>
    <span class="sep">|</span>
    <a class="aIcon" href="#" data-copy="${esc(link)}">
      <span class="ico ico-copy"></span><span>Kopiuj link</span>
    </a>
    <span class="sep">|</span>
    <a class="aIcon" href="${esc(sms)}">
      <span class="ico ico-sms"></span><span>SMS</span>
    </a>
  `;
}

async function loadVouchers(){
  const { data, error } = await sb
    .from("vouchers")
    .select("id, created_at, amount_text, status, recipient_name, short_code")
    .order("created_at", { ascending: false })
    .limit(500);

  if(error) throw error;
  return data || [];
}

async function loadOrders(){
  // voucher_orders mogą nie mieć short_code; łączymy po voucher_id jeśli jest
  const { data, error } = await sb
    .from("voucher_orders")
    .select("id, created_at, amount_text, status, recipient_name, voucher_id")
    .order("created_at", { ascending: false })
    .limit(500);

  if(error) throw error;
  return data || [];
}

function applyFilter(rows){
  const f = (filterStatusEl?.value || "all").toLowerCase();
  if(f === "all") return rows;
  return rows.filter(r => String(r.status || "").toLowerCase() === f);
}

function renderRows(rows){
  listTbody.innerHTML = "";

  if(!rows.length){
    listTbody.innerHTML = `<tr><td colspan="7" class="empty">Brak danych</td></tr>`;
    return;
  }

  for(const r of rows){
    const key = `${r.type}:${r.id}`;
    const checked = selected.has(key) ? "checked" : "";

    const code = r.code || "—";
    const to = r.to || "";
    const amount = r.amount || "";
    const status = r.status || "—";
    const stLower = String(status).toLowerCase();

    let actions = "—";
    if(r.type === "v"){
      actions = makeActionLinks({ voucherId: r.id, shortCode: r.code });
    }else if(r.type === "o"){
      // pending => przycisk "Wystaw voucher"
      if(stLower === "pending"){
        actions = `<button class="btnSmall" data-issue="${esc(r.id)}">Wystaw voucher</button>`;
      }
      // paid + voucher_id => linki (zostaje tylko wtedy, gdy voucher NIE istnieje w vouchers)
      else if(stLower === "paid" && r.voucher_id){
        actions = makeActionLinks({ voucherId: r.voucher_id, shortCode: r.code || "" });
      }else{
        actions = "—";
      }
    }

    listTbody.insertAdjacentHTML("beforeend", `
      <tr>
        <td class="chkCol">
          <input type="checkbox" class="rowChk" data-key="${esc(key)}" ${checked}>
        </td>
        <td>${esc(fmtDate(r.created_at))}</td>
        <td class="mono">${esc(code)}</td>
        <td><b>${esc(amount)}</b></td>
        <td>${esc(to)}</td>
        <td class="status">${esc(status)}</td>
        <td class="actionsCell">${actions}</td>
      </tr>
    `);
  }

  // copy handlers
  listTbody.querySelectorAll("[data-copy]").forEach(a => {
    a.addEventListener("click", async (e) => {
      e.preventDefault();
      const text = a.getAttribute("data-copy") || "";
      try{
        await navigator.clipboard.writeText(text);
        a.classList.add("copied");
        setTimeout(()=>a.classList.remove("copied"), 800);
      }catch{
        alert("Nie mogę skopiować. Skopiuj ręcznie:\n" + text);
      }
    });
  });

  // issue voucher handlers
  listTbody.querySelectorAll("[data-issue]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-issue");
      if(!id) return;
      btn.disabled = true;
      try{
        await window.issueVoucherFromOrder(id);
      }finally{
        btn.disabled = false;
      }
    });
  });

  // checkbox handlers
  listTbody.querySelectorAll(".rowChk").forEach(chk => {
    chk.addEventListener("change", () => {
      const k = chk.getAttribute("data-key");
      if(!k) return;

      if(chk.checked){
        const [type, id] = k.split(":");
        selected.set(k, { type, id });
      }else{
        selected.delete(k);
      }
      updateDeleteBtnState();
    });
  });
}

window.loadAll = async function loadAll(){
  try{
    resetSelection();

    const [vouchers, orders] = await Promise.all([loadVouchers(), loadOrders()]);

    // map voucher id -> short_code (albo id)
    const vMap = new Map();
    for(const v of vouchers){
      vMap.set(v.id, v.short_code || v.id);
    }

    // unify
    const rows = [];

    // 1) zawsze pokazuj vouchery (to jest "prawda" o kuponie)
    for(const v of vouchers){
      rows.push({
        type: "v",
        id: v.id,
        created_at: v.created_at,
        code: v.short_code || v.id,
        amount: v.amount_text || "",
        to: v.recipient_name || "",
        status: v.status || "—"
      });
    }

    // 2) zamówienia pokazuj tylko wtedy, gdy:
    //    - są pending (nie mają vouchera)
    //    - ALBO są paid, ale voucher jeszcze nie istnieje w tabeli vouchers (awaryjnie)
    for(const o of orders){
      const st = String(o.status || "").toLowerCase();

      const hasVoucherId = !!o.voucher_id;
      const voucherExists = hasVoucherId && vMap.has(o.voucher_id);

      // ✅ KLUCZOWE: jeśli zamówienie wskazuje na istniejący voucher, NIE dodawaj go (eliminuje duplikaty)
      if(voucherExists){
        continue;
      }

      // pending zawsze pokazujemy
      if(st === "pending"){
        rows.push({
          type: "o",
          id: o.id,
          created_at: o.created_at,
          code: "",
          amount: o.amount_text || "",
          to: o.recipient_name || "",
          status: o.status || "—",
          voucher_id: o.voucher_id || null
        });
        continue;
      }

      // paid bez vouchera (albo z voucher_id, którego nie ma w vouchers) — pokazujemy
      if(st === "paid"){
        rows.push({
          type: "o",
          id: o.id,
          created_at: o.created_at,
          code: (o.voucher_id && vMap.get(o.voucher_id)) ? vMap.get(o.voucher_id) : "",
          amount: o.amount_text || "",
          to: o.recipient_name || "",
          status: o.status || "—",
          voucher_id: o.voucher_id || null
        });
      }
    }

    // sort by created_at desc
    rows.sort((a,b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    const filtered = applyFilter(rows);
    renderRows(filtered);
  }catch(e){
    console.warn(e);
    listTbody.innerHTML = `<tr><td colspan="7" class="empty">Błąd: ${esc(e.message || e)}</td></tr>`;
  }
};

/* ================= DELETE SELECTED (history) ================= */

window.deleteSelected = async function deleteSelected(){
  if(selected.size === 0) return;

  const ok = confirm(`Usunąć zaznaczone wpisy? (${selected.size})\n\nUwaga: to usuwa rekordy z bazy.`);
  if(!ok) return;

  // grupuj
  const vIds = [];
  const oIds = [];

  for(const [k, v] of selected.entries()){
    if(v.type === "v") vIds.push(v.id);
    if(v.type === "o") oIds.push(v.id);
  }

  // usuń (admin tylko)
  try{
    if(vIds.length){
      const { error } = await sb.from("vouchers").delete().in("id", vIds);
      if(error) throw error;
    }
    if(oIds.length){
      const { error } = await sb.from("voucher_orders").delete().in("id", oIds);
      if(error) throw error;
    }

    await loadAll();
  }catch(e){
    alert("Błąd usuwania: " + (e?.message || e));
  }
};

/* ================= EVENTS ================= */

filterStatusEl?.addEventListener("change", () => loadAll());

checkAllEl?.addEventListener("change", () => {
  const checked = !!checkAllEl.checked;
  listTbody.querySelectorAll(".rowChk").forEach(chk => {
    chk.checked = checked;
    const k = chk.getAttribute("data-key");
    if(!k) return;
    if(checked){
      const [type, id] = k.split(":");
      selected.set(k, { type, id });
    }else{
      selected.delete(k);
    }
  });
  updateDeleteBtnState();
});

// ✅ PODPIĘCIE PRZYCISKU "Usuń zaznaczone" (jeśli istnieje w HTML)
deleteSelectedBtn?.addEventListener("click", () => window.deleteSelected());

// start
checkAuth();