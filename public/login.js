const statusEl = document.getElementById("status");
const form = document.getElementById("loginForm");

function setStatus(msg){ statusEl.textContent = msg; }

async function apiSend(url, method, body){
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(()=> ({}));
  if(!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const u = form.username.value.trim();
  const p = form.password.value;

  try{
    setStatus("Logging in...");
    const result = await apiSend("/auth/login", "POST", { username: u, password: p });

    // redirect based on role
    if(result.user.role === "admin") window.location.href = "/inventory.html";
    else window.location.href = "/pos.html";
  } catch(err){
    setStatus(err.message);
  }
});
