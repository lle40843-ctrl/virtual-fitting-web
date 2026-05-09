const isLocalHost = ["127.0.0.1", "localhost"].includes(window.location.hostname);

export const API_BASE_URL =
  window.__VIRTUAL_FITTING_API_BASE_URL__ ||
  (isLocalHost
    ? "http://127.0.0.1:8787"
    : "https://virtual-fitting-backend.onrender.com");
