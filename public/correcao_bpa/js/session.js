(function () {
  "use strict";

  const appShell = document.getElementById("appShell");
  const topbarUsername = document.getElementById("topbarUsername");
  const btnLogout = document.getElementById("btnLogout");

  btnLogout.addEventListener("click", async () => {
    await fetch("/api/logout", { method: "POST", credentials: "include" });
    location.href = "/";
  });

  fetch("/api/me", { credentials: "include" })
    .then((res) => (res.ok ? res.json() : Promise.reject()))
    .then((me) => {
      topbarUsername.textContent = me.name + (me.isAdmin ? " · Administrador" : "");
      appShell.classList.remove("hidden");
    })
    .catch(() => { location.href = "/"; });

})();
