import { hydrateIcons } from './lib/icons.js';

hydrateIcons();
const $ = (s) => document.querySelector(s);
const need = (new URLSearchParams(location.search).get('need') || 'microphone,camera').split(',');

$('#grant').onclick = async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: need.includes('microphone'), video: need.includes('camera') });
    stream.getTracks().forEach((t) => t.stop());
    $('#status').className = 'ok';
    $('#status').textContent = 'Access granted. Open LupaX again and press Start Recording.';
    $('#grant').disabled = true;
    setTimeout(() => window.close(), 2500);
  } catch (e) {
    $('#status').className = '';
    $('#status').textContent = `Permission was not granted (${e.name}). You can allow it from the camera icon in the address bar.`;
  }
};
