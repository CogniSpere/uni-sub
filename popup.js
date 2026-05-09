// popup.js
const substrate = await window.WCO.getSubstrate();

document.getElementById("status").textContent =
  "Loaded modules: " + substrate.listModules().join(", ");
