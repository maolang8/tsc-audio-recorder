'use strict';

const params = new URLSearchParams(location.hash.slice(1));
const nonce = params.get('nonce');
const parentOrigin = params.get('origin') || '';
const openerWindow = window.opener;
const trustedOrigin = /^https:\/\/(script\.google\.com|[a-z0-9-]+-script\.googleusercontent\.com)$/.test(parentOrigin);
const start = document.getElementById('start');
const stop = document.getElementById('stop');
const status = document.getElementById('status');
let seconds = 0;
let recorder;
let stream;
let clock;
let cancelled = false;

function send(type, payload = {}) {
  if (trustedOrigin && openerWindow && nonce) {
    openerWindow.postMessage({type, nonce, ...payload}, parentOrigin);
  }
}

function releaseMicrophone() {
  clearInterval(clock);
  stream?.getTracks().forEach(track => track.stop());
}

window.addEventListener('message', event => {
  if (event.origin !== parentOrigin || event.source !== openerWindow || event.data?.nonce !== nonce) return;
  if (event.data.type === 'tsc-init' && !seconds) {
    seconds = Number(event.data.seconds);
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 600) return;
    status.textContent = '녹음 시작을 누르고 마이크를 허용하세요.';
    start.disabled = false;
  }
  if (event.data.type === 'tsc-received') {
    status.textContent = '시험 화면에 답변을 전달했습니다. 이 탭을 닫아도 됩니다.';
    window.close();
  }
});

start.addEventListener('click', async () => {
  start.disabled = true;
  status.textContent = '마이크 연결 중입니다.';
  try {
    stream = await navigator.mediaDevices.getUserMedia({audio: true});
    if (cancelled) {
      releaseMicrophone();
      return;
    }
    const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg']
      .find(type => MediaRecorder.isTypeSupported(type));
    recorder = new MediaRecorder(stream, mimeType ? {mimeType} : undefined);
    const chunks = [];
    recorder.addEventListener('dataavailable', event => {
      if (event.data.size) chunks.push(event.data);
    });
    recorder.addEventListener('stop', () => {
      releaseMicrophone();
      stop.disabled = true;
      if (cancelled) return;
      const audio = new Blob(chunks, {type: recorder.mimeType || chunks[0]?.type});
      if (!audio.size) {
        status.textContent = '녹음된 소리가 없습니다. 다시 시도해 주세요.';
        start.disabled = false;
        return;
      }
      status.textContent = '시험 화면으로 답변을 전달하는 중입니다.';
      send('tsc-audio', {audio});
    });
    recorder.addEventListener('error', () => {
      releaseMicrophone();
      status.textContent = '녹음 중 오류가 발생했습니다. 다시 시도해 주세요.';
      stop.disabled = true;
      start.disabled = false;
    });
    recorder.start();
    const deadline = Date.now() + seconds * 1000;
    const update = () => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      status.textContent = '녹음 중 · ' + remaining + '초 남음';
      if (!remaining && recorder.state === 'recording') recorder.stop();
    };
    stop.disabled = false;
    update();
    clock = setInterval(update, 100);
  } catch (error) {
    releaseMicrophone();
    status.textContent = error.name === 'NotAllowedError'
      ? '브라우저에서 이 화면의 마이크를 허용한 뒤 다시 시도해 주세요.'
      : '마이크를 사용할 수 없습니다. 기기 설정을 확인하거나 시험 화면으로 돌아가세요.';
    start.disabled = false;
  }
});

stop.addEventListener('click', () => {
  if (recorder?.state === 'recording') recorder.stop();
});
document.getElementById('cancel').addEventListener('click', () => {
  cancelled = true;
  releaseMicrophone();
  send('tsc-cancel');
  window.close();
});
window.addEventListener('pagehide', releaseMicrophone);

if (trustedOrigin && openerWindow && nonce) send('tsc-ready');
else status.textContent = '시험 화면의 녹음 버튼을 눌러 이 화면을 열어 주세요.';
