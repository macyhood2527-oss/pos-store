let cart = []; // { product_id, sku, name, unit_price, qty }

const statusEl = document.getElementById("status");
const scanForm = document.getElementById("scanForm");
const codeInput = document.getElementById("codeInput");
const qtyInput = document.getElementById("qtyInput");

const cartTbody = document.getElementById("cartTbody");
const emptyCart = document.getElementById("emptyCart");

const subtotalEl = document.getElementById("subtotal");
const totalEl = document.getElementById("total");
const changeEl = document.getElementById("change");
const discountEl = document.getElementById("discount");
const cashEl = document.getElementById("cash");

const clearCartBtn = document.getElementById("clearCartBtn");
const checkoutBtn = document.getElementById("checkoutBtn");
const lastReceiptEl = document.getElementById("lastReceipt");

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

async function apiSend(url, method, body) {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function calcSubtotal() {
  return cart.reduce((sum, it) => sum + (Number(it.unit_price) * Number(it.qty)), 0);
}

function calcTotal() {
  const sub = calcSubtotal();
  const disc = Number(discountEl.value || 0);
  return Math.max(0, Number((sub - disc).toFixed(2)));
}

function calcChange() {
  const total = calcTotal();
  const cash = Number(cashEl.value || 0);
  return Number((cash - total).toFixed(2));
}

function renderCart() {
  cartTbody.innerHTML = "";

  if (!cart.length) {
    emptyCart.style.display = "block";
  } else {
    emptyCart.style.display = "none";
  }

  for (const item of cart) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <div><b>${item.name}</b></div>
        <div class="small muted">${item.sku}</div>
      </td>
      <td>${money(item.unit_price)}</td>
      <td>
        <div class="actions">
          <button class="secondary" data-act="dec" data-id="${item.product_id}">-</button>
          <span style="min-width:40px; text-align:center; display:inline-block;">${item.qty}</span>
          <button class="secondary" data-act="inc" data-id="${item.product_id}">+</button>
        </div>
      </td>
      <td>${money(Number(item.unit_price) * Number(item.qty))}</td>
      <td><button class="secondary" data-act="rm" data-id="${item.product_id}">Remove</button></td>
    `;
    cartTbody.appendChild(tr);
  }

  const sub = calcSubtotal();
  const total = calcTotal();
  const change = calcChange();

  subtotalEl.textContent = money(sub);
  totalEl.textContent = money(total);
  changeEl.textContent = money(Math.max(0, change));
}

function upsertCartItem(p, qtyToAdd) {
  const existing = cart.find(x => x.product_id === p.id);
  if (existing) {
    existing.qty += qtyToAdd;
  } else {
    cart.push({
      product_id: p.id,
      sku: p.sku,
      name: p.name,
      unit_price: Number(p.current_price),
      qty: qtyToAdd,
    });
  }
}

scanForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const code = codeInput.value.trim();
  const qty = Number(qtyInput.value || 1);

  if (!code) return;
  if (!Number.isInteger(qty) || qty <= 0) {
    setStatus("Qty must be a whole number > 0");
    return;
  }

  try {
    setStatus("Looking up item...");
    const product = await apiGet(`/products/lookup?code=${encodeURIComponent(code)}`);

    upsertCartItem(product, qty);
    renderCart();

    codeInput.value = "";
    qtyInput.value = 1;
    codeInput.focus();

    setStatus(`Added: ${product.sku} ✅`);
  } catch (err) {
    setStatus(err.message);
    codeInput.select();
  }
});

cartTbody.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;

  const act = btn.dataset.act;
  const id = Number(btn.dataset.id);
  const it = cart.find(x => x.product_id === id);
  if (!it) return;

  if (act === "inc") it.qty += 1;
  if (act === "dec") it.qty = Math.max(1, it.qty - 1);
  if (act === "rm") cart = cart.filter(x => x.product_id !== id);

  renderCart();
});

discountEl.addEventListener("input", renderCart);
cashEl.addEventListener("input", renderCart);

clearCartBtn.addEventListener("click", () => {
  cart = [];
  lastReceiptEl.textContent = "";
  renderCart();
  setStatus("Cart cleared");
  codeInput.focus();
});

checkoutBtn.addEventListener("click", async () => {
  if (!cart.length) return setStatus("Cart is empty");

  const discount = Number(discountEl.value || 0);
  const cash = Number(cashEl.value || 0);
  const total = calcTotal();

  if (discount < 0) return setStatus("Discount must be >= 0");
  if (cash < total) return setStatus("Insufficient cash");

  try {
    setStatus("Checking out...");

    const payload = {
      items: cart.map(it => ({ product_id: it.product_id, qty: it.qty })),
      discount,
      cash_received: cash,
    };

    const result = await apiSend("/sales", "POST", payload);

    lastReceiptEl.textContent = `Receipt: ${result.receipt_no} • Change: ${money(result.change_due)}`;
    window.open(`/receipt.html?receipt=${encodeURIComponent(result.receipt_no)}`, "_blank");



    // reset cart for next customer
    cart = [];
    discountEl.value = 0;
    cashEl.value = 0;

    renderCart();
    setStatus("Sale completed ✅");
    codeInput.focus();
  } catch (err) {
    setStatus(err.message);
  }
});

document.getElementById("receiptLookupForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const receiptNo = e.target.receipt_no.value.trim();
  if (!receiptNo) return;
  window.open(`/receipt.html?receipt=${encodeURIComponent(receiptNo)}`, "_blank");
});


// init
renderCart();
codeInput.focus();
