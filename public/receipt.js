const statusEl = document.getElementById("status");
const receiptNoEl = document.getElementById("receiptNo");
const soldAtEl = document.getElementById("soldAt");
const saleIdEl = document.getElementById("saleId");

const itemsTbody = document.getElementById("itemsTbody");
const subtotalEl = document.getElementById("subtotal");
const discountEl = document.getElementById("discount");
const totalEl = document.getElementById("total");
const cashEl = document.getElementById("cash");
const changeEl = document.getElementById("change");

const printBtn = document.getElementById("printBtn");

function setStatus(msg) {
  statusEl.textContent = msg;
}

function money(v) {
  const n = Number(v ?? 0);
  return `₱${n.toFixed(2)}`;
}

async function apiGet(url) {
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function getQueryParam(name) {
  const u = new URL(window.location.href);
  return u.searchParams.get(name);
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

async function loadReceipt() {
  const receipt = String(getQueryParam("receipt") || "").trim();

  if (!receipt) {
    setStatus("Missing receipt code");
    receiptNoEl.textContent = "-";
    itemsTbody.innerHTML = `<tr><td colspan="4" class="small">No receipt code provided.</td></tr>`;
    return;
  }

  setStatus("Loading receipt...");
  receiptNoEl.textContent = receipt;

  const data = await apiGet(`/sales/receipt/${encodeURIComponent(receipt)}`);

  const sale = data.sale;
  const items = Array.isArray(data.items) ? data.items : [];

  saleIdEl.textContent = `Sale #${sale.id}`;
  soldAtEl.textContent = new Date(sale.sold_at).toLocaleString();

  // render items
  if (!items.length) {
    itemsTbody.innerHTML = `<tr><td colspan="4" class="small">No items found.</td></tr>`;
  } else {
    itemsTbody.innerHTML = items.map(it => `
      <tr>
        <td>
          <div><b>${esc(it.name_snapshot)}</b></div>
          <div class="small mono">${esc(it.sku_snapshot)}</div>
        </td>
        <td class="r">${it.qty}</td>
        <td class="r">${money(it.unit_price)}</td>
        <td class="r"><b>${money(it.line_total)}</b></td>
      </tr>
    `).join("");
  }

  // totals (your sales table already has these)
  subtotalEl.textContent = money(sale.subtotal);
  discountEl.textContent = money(sale.discount);
  totalEl.textContent = money(sale.total_amount);
  cashEl.textContent = money(sale.cash_received);
  changeEl.textContent = money(sale.change_due);

  setStatus("Loaded ✅");
}

printBtn.addEventListener("click", () => window.print());

// init
loadReceipt().catch(err => {
  console.error(err);
  setStatus(err.message);
});
