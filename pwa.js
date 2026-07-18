export function registerServiceWorker({ onUpdate }) {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', async () => {
    const registration = await navigator.serviceWorker.register('sw.js');
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) onUpdate();
      });
    });
  });

  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload());
}

export function applyServiceWorkerUpdate() {
  navigator.serviceWorker?.controller?.postMessage({ type: 'SKIP_WAITING' });
}
