export function speak(text, enabled) {
  if (enabled && 'speechSynthesis' in window) {
    speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  }
}

export function notify(title, body, { voice = false } = {}) {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body, icon: 'icons/icon.svg' });
  }
  speak(`${title}. ${body}`, voice);
}

export function beep({ enabled, type, volume, repeats = 1 }) {
  if (!enabled) return;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;

  const context = new AudioContext();
  const patterns = {
    classic: [880, 660],
    soft: [523, 659],
    alert: [988, 784, 988]
  };
  const tones = patterns[type] || patterns.classic;

  for (let index = 0; index < repeats; index += 1) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.frequency.value = tones[index % tones.length];
    gain.gain.setValueAtTime(volume, context.currentTime + index * 0.22);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + index * 0.22 + 0.18);
    oscillator.start(context.currentTime + index * 0.22);
    oscillator.stop(context.currentTime + index * 0.22 + 0.2);
  }

  if ('vibrate' in navigator) navigator.vibrate([120, 70, 120]);
}
