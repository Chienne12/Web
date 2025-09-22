// JS tối thiểu cho micro-interactions demo

// Quản lý trạng thái kết nối
let connectionState = 'disconnected'; // disconnected, connecting, connected
let peerConnection = null;
let statsInterval = null;

// Quản lý chất lượng video
let currentQuality = '1080p'; // 720p, 1080p, auto
let mediaRecorder = null;
let recordedChunks = [];

// ==== Signaling (WebSocket) state ====
let ws = null;
let wsReady = false;
let currentSessionId = null;

// Kết nối WebSocket và join phòng
const SERVER_HOST = '150.95.114.174:8082'; // Server thật
function connectSignaling(sessionId){
  currentSessionId = sessionId;
  if (ws && ws.readyState === WebSocket.OPEN) return;
  try {
    const isHttps = location.protocol === 'https:';
    const scheme = isHttps ? 'wss' : 'ws';
    ws = new WebSocket(`${scheme}://${SERVER_HOST}`);
    ws.onopen = () => {
      wsReady = true;
      console.log('[WS] opened');
      ws.send(JSON.stringify({ type:'join', sessionId, role:'web' }));
    };
    ws.onclose = (e) => { wsReady = false; console.log('[WS] closed', e.code, e.reason); };
    ws.onerror = (e) => { console.error('[WS] error', e); };
    ws.onmessage = (e) => {
      try { handleSignal(JSON.parse(e.data)); }
      catch(err){ console.error('[WS] parse error', err, e.data); }
    };
  } catch (err) {
    console.error('Không thể mở WebSocket:', err);
  }
}

// Tạo peerConnection nếu chưa có (web = receiver)
async function ensurePeer(){
  if (peerConnection) return peerConnection;
  peerConnection = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  });
  // Nhận video/audio (recvonly)
  try {
    if (peerConnection.addTransceiver){
      peerConnection.addTransceiver('video', { direction: 'recvonly' });
      peerConnection.addTransceiver('audio', { direction: 'recvonly' });
    }
  } catch {}

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      sendSignalingMessage({ type: 'ice', candidate: event.candidate });
    }
  };
  peerConnection.ontrack = (event) => {
    console.log('🎬 ontrack fired! Stream:', event.streams[0]);
    console.log('📊 Stream tracks:', event.streams[0].getTracks().map(t => `${t.kind}: ${t.enabled}`));
    
    // Kiểm tra video tracks chi tiết
    const videoTracks = event.streams[0].getVideoTracks();
    console.log('🎥 Video tracks count:', videoTracks.length);
    
    if (videoTracks.length === 0) {
      console.error('❌ NO VIDEO TRACKS RECEIVED!');
      console.log('🔍 Audio tracks:', event.streams[0].getAudioTracks().length);
      return;
    }
    
    console.log('✅ VIDEO TRACKS RECEIVED!');
    videoTracks.forEach((track, index) => {
      console.log(`🎥 Video track ${index} settings:`, track.getSettings());
      console.log(`🎥 Video track ${index} enabled:`, track.enabled);
    });
    
    const video = document.querySelector('.player video') || createVideoElement();
    
    // Dừng video hiện tại trước khi gán stream mới
    if (video.srcObject) {
      video.pause();
      video.srcObject = null;
    }
    
    // Gán stream mới và play
    video.srcObject = event.streams[0];
    
    // Đợi video có metadata (dimensions)
    video.addEventListener('loadedmetadata', () => {
      console.log('📺 Video metadata loaded:', video.videoWidth, 'x', video.videoHeight);
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        console.log('✅ Video has valid dimensions, showing video');
        hidePlayButton();
      } else {
        console.warn('⚠️ Video dimensions still 0x0 after metadata loaded');
      }
    });
    
    video.play().then(() => {
      console.log('✅ Video playing successfully');
      console.log('🎬 Video playing dimensions:', video.videoWidth, 'x', video.videoHeight);
      updateConnectionUI('connected');
    }).catch(e => {
      console.error('❌ Video play failed:', e);
      // Thử play lại sau 100ms
      setTimeout(() => {
        video.play().then(() => {
          console.log('✅ Video playing on retry');
        }).catch(e2 => {
          console.error('❌ Video play retry failed:', e2);
        });
      }, 100);
    });
  };
  peerConnection.onconnectionstatechange = () => {
    if (peerConnection.connectionState === 'connected') {
      updateConnectionUI('connected');
    } else if (['disconnected','failed','closed'].includes(peerConnection.connectionState)) {
      updateConnectionUI('disconnected');
    }
  };
  return peerConnection;
}

// Nhận message từ server (sẽ mở rộng ở bước Offer/Answer)
async function handleSignal(msg){
  console.log('[WS] recv:', msg);
  
  // Room system messages
  if (msg.type === 'room-created') {
    console.log('✅ Room created successfully:', msg.roomCode);
    updateConnectionUI('connecting');
  } else if (msg.type === 'peer-joined') {
    console.log('📱 Android joined room:', msg.roomCode);
    updateConnectionUI('connected');
  } else if (msg.type === 'error') {
    console.error('❌ Server error:', msg.message);
    updateConnectionUI('disconnected');
  }
  // WebRTC signaling messages
  else if (msg.type === 'offer' && msg.sdp){
    console.log('📥 Processing offer from Android...');
    const pc = await ensurePeer();
    await pc.setRemoteDescription({ type: 'offer', sdp: msg.sdp });
    console.log('✅ Remote description set');
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    console.log('✅ Answer created and set');
    sendSignalingMessage({ type: 'answer', sdp: answer.sdp });
    console.log('📤 Answer sent to Android');
    hidePlayButton();
  } else if (msg.type === 'ice' && msg.candidate){
    try {
      const pc = await ensurePeer();
      // Chỉ thêm ICE candidate nếu đã có remote description
      if (pc.remoteDescription) {
        await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
        console.log('[ICE] Added candidate successfully');
      } else {
        console.log('[ICE] Skipping candidate - no remote description yet');
      }
    } catch (e){ console.error('addIceCandidate error', e); }
  }
}

// Gửi signaling message qua WebSocket
function sendSignalingMessage(message) {
  if (!wsReady || !ws || ws.readyState !== WebSocket.OPEN){
    console.warn('[WS] not ready, drop:', message);
    return;
  }
  if (!message.sessionId) message.sessionId = currentSessionId || 'ABC123';
  ws.send(JSON.stringify(message));
}

// Cập nhật UI trạng thái kết nối
function updateConnectionUI(state) {
  const statusEl = document.getElementById('connectionStatus');
  const telemetryEl = document.getElementById('telemetryChips');
  
  connectionState = state;
  
  switch(state) {
    case 'disconnected':
      statusEl.textContent = 'Kết nối';
      statusEl.className = 'badge connecting';
      updateTelemetryDisplay(0, 0, 0); // Hiển thị 0 khi chưa kết nối
      break;
    case 'connecting':
      statusEl.textContent = 'Đang kết nối...';
      statusEl.className = 'badge connecting';
      updateTelemetryDisplay(0, 0, 0); // Hiển thị 0 khi đang kết nối
      break;
    case 'connected':
      statusEl.textContent = 'Sẵn sàng';
      statusEl.className = 'badge connected';
      hidePlayButton(); // Ẩn nút play khi đã kết nối
      startTelemetryCollection();
      break;
  }
}

// Bắt đầu thu thập telemetry thật từ WebRTC
function startTelemetryCollection() {
  if (statsInterval) clearInterval(statsInterval);
  
  statsInterval = setInterval(async () => {
    if (!peerConnection) return;
    
    try {
      const stats = await peerConnection.getStats();
      let latency = 0;
      let bitrate = 0;
      let fps = 0;
      
      stats.forEach(report => {
        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          latency = report.currentRoundTripTime * 1000; // ms
        }
        if (report.type === 'inbound-rtp' && report.mediaType === 'video') {
          bitrate = report.bytesReceived * 8 / 1000000; // Mbps
          fps = report.framesPerSecond || 0;
        }
      });
      
      updateTelemetryDisplay(latency, bitrate, fps);
    } catch (error) {
      console.error('Lỗi thu thập stats:', error);
      // Fallback về mock data nếu có lỗi
      updateTelemetry();
    }
  }, 1000);
}

// Cập nhật hiển thị telemetry
function updateTelemetryDisplay(latency, bitrate, fps) {
  const latencyChip = document.getElementById('latencyChip');
  const bitrateChip = document.getElementById('bitrateChip');
  const fpsChip = document.getElementById('fpsChip');
  
  if (latencyChip) latencyChip.textContent = `${Math.round(latency)} ms`;
  if (bitrateChip) bitrateChip.textContent = `${bitrate.toFixed(1)} Mbps`;
  if (fpsChip) fpsChip.textContent = `${Math.round(fps)} FPS`;
}

// Ẩn nút play khi đã kết nối
function hidePlayButton() {
  const playBtn = document.querySelector('.play-btn');
  const hint = document.querySelector('.hint');
  if (playBtn) playBtn.style.display = 'none';
  if (hint) hint.style.display = 'none';
}

// Hiện nút play khi chưa kết nối
function showPlayButton() {
  const playBtn = document.querySelector('.play-btn');
  const hint = document.querySelector('.hint');
  if (playBtn) playBtn.style.display = 'flex';
  if (hint) hint.style.display = 'block';
}

// Bắt đầu kết nối WebRTC
async function startConnection() {
  try {
    updateConnectionUI('connecting');
    
    // Tạo peer connection
    peerConnection = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });
    
    // Xử lý ICE candidates
    peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('ICE candidate:', event.candidate);
        // Gửi candidate đến Android app qua signaling
        sendSignalingMessage({
          type: 'ice-candidate',
          candidate: event.candidate
        });
      }
    };
    
    // Xử lý khi có stream từ remote
    peerConnection.ontrack = (event) => {
      console.log('Nhận được stream:', event.streams[0]);
      // Hiển thị video stream
      const video = document.querySelector('.player video') || createVideoElement();
      video.srcObject = event.streams[0];
    };
    
    // Xử lý connection state changes
    peerConnection.onconnectionstatechange = () => {
      console.log('Connection state:', peerConnection.connectionState);
      if (peerConnection.connectionState === 'connected') {
        updateConnectionUI('connected');
      } else if (peerConnection.connectionState === 'disconnected' || 
                 peerConnection.connectionState === 'failed') {
        updateConnectionUI('disconnected');
      }
    };
    
    // Tạo offer
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    
    // Gửi offer đến Android app
    sendSignalingMessage({
      type: 'offer',
      sdp: offer.sdp
    });
    
  } catch (error) {
    console.error('Lỗi kết nối:', error);
    showPlayButton(); // Hiện lại nút play khi kết nối thất bại
    updateConnectionUI('disconnected');
    alert('Không thể kết nối. Vui lòng thử lại.');
  }
}

// Ngắt kết nối
function disconnect() {
  if (statsInterval) {
    clearInterval(statsInterval);
    statsInterval = null;
  }
  
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  
  showPlayButton(); // Hiện lại nút play khi ngắt kết nối
  updateConnectionUI('disconnected');
}

// Tạo video element nếu chưa có
function createVideoElement() {
  const player = document.querySelector('.player');
  const video = document.createElement('video');
  video.autoplay = true;
  video.muted = true;
  video.style.width = '100%';
  video.style.height = '100%';
  video.style.objectFit = 'cover';
  player.appendChild(video);
  return video;
}

// Xử lý thay đổi chất lượng video
function handleQualityChange(quality) {
  console.log('Thay đổi chất lượng video:', quality);
  currentQuality = quality;
  
  if (peerConnection && connectionState === 'connected') {
    // Gửi yêu cầu thay đổi chất lượng đến Android app
    sendSignalingMessage({
      type: 'quality-change',
      quality: quality
    });
    
    // Cập nhật video constraints nếu có video track
    const videoTrack = peerConnection.getSenders().find(sender => 
      sender.track && sender.track.kind === 'video'
    );
    
    if (videoTrack) {
      const constraints = getVideoConstraints(quality);
      videoTrack.applyConstraints(constraints).then(() => {
        console.log('✅ Đã áp dụng chất lượng:', quality);
      }).catch(err => {
        console.error('❌ Lỗi thay đổi chất lượng:', err);
      });
    }
  } else {
    console.log('Chưa kết nối - lưu tùy chọn chất lượng');
    localStorage.setItem('preferredQuality', quality);
  }
}

// Lấy video constraints theo chất lượng
function getVideoConstraints(quality) {
  switch(quality) {
    case '720p':
      return {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30 }
      };
    case '1080p':
      return {
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30 }
      };
    case 'Auto (ABR)':
      return {
        width: { ideal: 1920, max: 1920 },
        height: { ideal: 1080, max: 1080 },
        frameRate: { ideal: 30, max: 60 }
      };
    default:
      return {};
  }
}

// Xử lý yêu cầu Keyframe
function handleKeyframeRequest() {
  console.log('Gửi yêu cầu Keyframe');
  
  if (peerConnection && connectionState === 'connected') {
    // Gửi yêu cầu keyframe đến Android app
    sendSignalingMessage({
      type: 'keyframe-request'
    });
    
    // Cũng có thể gửi qua WebRTC data channel nếu có
    const dataChannel = peerConnection.createDataChannel('keyframe-request');
    dataChannel.send(JSON.stringify({ type: 'keyframe-request' }));
    
    console.log('✅ Đã gửi yêu cầu Keyframe');
  } else {
    console.log('❌ Chưa kết nối - không thể gửi keyframe request');
  }
}

// Xử lý bật/tắt ghi MP4
function handleRecordingToggle() {
  const recordButton = document.querySelector('[data-icon="record"]');
  
  if (!mediaRecorder || mediaRecorder.state === 'inactive') {
    startRecording();
    if (recordButton) {
      recordButton.textContent = '⏹ Dừng ghi';
      recordButton.classList.add('recording');
    }
  } else {
    stopRecording();
    if (recordButton) {
      recordButton.textContent = '● Ghi MP4';
      recordButton.classList.remove('recording');
    }
  }
}

// Bắt đầu ghi video
function startRecording() {
  const video = document.querySelector('.player video');
  if (!video || !video.srcObject) {
    console.error('Không có video stream để ghi');
    alert('Chưa có video để ghi. Vui lòng kết nối trước!');
    // Reset button về trạng thái ban đầu
    const recordButton = document.querySelector('[data-icon="record"]');
    if (recordButton) {
      recordButton.textContent = '● Ghi MP4';
      recordButton.classList.remove('recording');
    }
    return;
  }
  
  try {
    const stream = video.srcObject;
    mediaRecorder = new MediaRecorder(stream, {
      mimeType: 'video/mp4; codecs="avc1.42E01E"'
    });
    
    recordedChunks = [];
    
    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordedChunks.push(event.data);
        console.log('📹 Đã ghi chunk:', event.data.size, 'bytes');
      }
    };
    
    mediaRecorder.onstop = () => {
      console.log('🛑 Đã dừng ghi, tạo file MP4...');
      const blob = new Blob(recordedChunks, { type: 'video/mp4' });
      downloadVideo(blob);
    };
    
    mediaRecorder.onerror = (event) => {
      console.error('❌ Lỗi MediaRecorder:', event.error);
    };
    
    mediaRecorder.start(1000); // Ghi mỗi 1 giây
    console.log('✅ Bắt đầu ghi video MP4');
    
  } catch (error) {
    console.error('❌ Lỗi bắt đầu ghi video:', error);
    alert('Không thể bắt đầu ghi video: ' + error.message);
    // Reset button về trạng thái ban đầu
    const recordButton = document.querySelector('[data-icon="record"]');
    if (recordButton) {
      recordButton.textContent = '● Ghi MP4';
      recordButton.classList.remove('recording');
    }
  }
}

// Dừng ghi video
function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    console.log('🛑 Đang dừng ghi video...');
    mediaRecorder.stop();
    console.log('✅ Đã dừng ghi video');
  } else {
    console.log('❌ MediaRecorder không hoạt động hoặc đã dừng');
  }
}

// Tải xuống video đã ghi
function downloadVideo(blob) {
  if (!blob || blob.size === 0) {
    console.error('❌ Không có dữ liệu video để tải xuống');
    alert('Không có dữ liệu video để tải xuống!');
    return;
  }
  
  console.log('📁 Tạo file MP4, kích thước:', blob.size, 'bytes');
  
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `linkcast-recording-${new Date().toISOString().slice(0,19).replace(/:/g, '-')}.mp4`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  console.log('✅ Video đã được tải xuống:', a.download);
  alert(`Video đã được tải xuống: ${a.download}`);
}

// Khởi tạo Settings
function initSettings() {
  // Load saved settings
  loadSettings();
  
  // Audio input toggle
  const audioInputToggle = document.getElementById('audioInput');
  if (audioInputToggle) {
    audioInputToggle.addEventListener('change', (e) => {
      const enabled = e.target.checked;
      console.log('Audio input:', enabled ? 'BẬT' : 'TẮT');
      
      // Gửi đến Android app
      sendSignalingMessage({
        type: 'audio-input-toggle',
        enabled: enabled
      });
      
      // Lưu vào localStorage
      localStorage.setItem('audioInputEnabled', enabled);
    });
  }
  
  // Notification toggle
  const notificationToggle = document.getElementById('showNotify');
  if (notificationToggle) {
    notificationToggle.addEventListener('change', (e) => {
      const enabled = e.target.checked;
      console.log('Notifications:', enabled ? 'BẬT' : 'TẮT');
      
      // Lưu vào localStorage
      localStorage.setItem('notificationsEnabled', enabled);
      
      // Có thể request notification permission
      if (enabled && 'Notification' in window) {
        Notification.requestPermission();
      }
    });
  }
  
  // Volume controls
  const micVolSlider = document.getElementById('micVol');
  const masterVolSlider = document.getElementById('masterVol');
  const brightnessSlider = document.getElementById('brightness');
  
  if (micVolSlider) {
    micVolSlider.addEventListener('input', (e) => {
      const volume = parseInt(e.target.value);
      console.log('Mic volume:', volume);
      
      // Gửi đến Android app
      sendSignalingMessage({
        type: 'mic-volume-change',
        volume: volume
      });
      
      // Lưu vào localStorage
      localStorage.setItem('micVolume', volume);
    });
  }
  
  if (masterVolSlider) {
    masterVolSlider.addEventListener('input', (e) => {
      const volume = parseInt(e.target.value);
      console.log('Master volume:', volume);
      
      // Gửi đến Android app
      sendSignalingMessage({
        type: 'master-volume-change',
        volume: volume
      });
      
      // Lưu vào localStorage
      localStorage.setItem('masterVolume', volume);
    });
  }
  
  if (brightnessSlider) {
    brightnessSlider.addEventListener('input', (e) => {
      const brightness = parseInt(e.target.value);
      console.log('Brightness:', brightness);
      
      // Gửi đến Android app
      sendSignalingMessage({
        type: 'brightness-change',
        brightness: brightness
      });
      
      // Lưu vào localStorage
      localStorage.setItem('brightness', brightness);
    });
  }
}

// Load settings từ localStorage
function loadSettings() {
  // Audio input
  const audioInputEnabled = localStorage.getItem('audioInputEnabled') === 'true';
  const audioInputToggle = document.getElementById('audioInput');
  if (audioInputToggle) {
    audioInputToggle.checked = audioInputEnabled;
  }
  
  // Notifications
  const notificationsEnabled = localStorage.getItem('notificationsEnabled') !== 'false';
  const notificationToggle = document.getElementById('showNotify');
  if (notificationToggle) {
    notificationToggle.checked = notificationsEnabled;
  }
  
  // Volumes
  const micVolume = parseInt(localStorage.getItem('micVolume')) || 75;
  const masterVolume = parseInt(localStorage.getItem('masterVolume')) || 50;
  const brightness = parseInt(localStorage.getItem('brightness')) || 80;
  
  const micVolSlider = document.getElementById('micVol');
  const masterVolSlider = document.getElementById('masterVol');
  const brightnessSlider = document.getElementById('brightness');
  
  if (micVolSlider) {
    micVolSlider.value = micVolume;
    document.getElementById('micVolVal').textContent = micVolume;
  }
  
  if (masterVolSlider) {
    masterVolSlider.value = masterVolume;
    document.getElementById('masterVolVal').textContent = masterVolume;
  }
  
  if (brightnessSlider) {
    brightnessSlider.value = brightness;
    document.getElementById('brightnessVal').textContent = brightness;
  }
}

// Toggle fullscreen
function toggleFullscreen() {
  const player = document.querySelector('.player');
  if (!player) return;
  
  if (!document.fullscreenElement) {
    // Vào fullscreen
    player.requestFullscreen().then(() => {
      console.log('Đã vào fullscreen');
    }).catch(err => {
      console.error('Lỗi fullscreen:', err);
    });
  } else {
    // Thoát fullscreen
    document.exitFullscreen().then(() => {
      console.log('Đã thoát fullscreen');
    }).catch(err => {
      console.error('Lỗi thoát fullscreen:', err);
    });
  }
}

document.addEventListener('click', (e) => {
  // menu routing
  const menuLink = e.target.closest('.menu .item');
  if (menuLink) {
    const route = menuLink.getAttribute('data-route');
    document.querySelectorAll('.menu .item').forEach(i=>i.classList.remove('active'));
    menuLink.classList.add('active');
    toggleRoute(route || 'overview');
    return;
  }
  if (e.target.closest('.play-btn')) {
    const btn = e.target.closest('.play-btn');
    btn.classList.toggle('is-playing');
    if (btn.classList.contains('is-playing')) {
      autoSmartCast();
    }
  }
  
  // Xử lý click nút kết nối
  if (e.target.closest('#connectionStatus')) {
    if (connectionState === 'disconnected') {
      startConnection();
    } else if (connectionState === 'connected') {
      disconnect();
    }
  }
  
  // Xử lý click nút fullscreen
  if (e.target.closest('#btnFullscreen')) {
    console.log('Click nút fullscreen detected!');
    e.preventDefault();
    e.stopPropagation();
    toggleFullscreen();
  }
  if (e.target.classList.contains('chip')) {
    // mở preset menu nếu là chip preset
    if (e.target.id === 'btnPreset'){
      const menu = document.getElementById('presetMenu');
      if (menu){
        // tạo backdrop và hiện menu giữa màn hình
        if (menu.classList.contains('hidden')){
          const backdrop = document.createElement('div');
          backdrop.className = 'preset-backdrop';
          backdrop.id = 'presetBackdrop';
          document.body.appendChild(backdrop);
          backdrop.addEventListener('click', ()=>{
            menu.classList.add('hidden');
            backdrop.remove();
          });
          menu.classList.remove('hidden');
        } else {
          menu.classList.add('hidden');
          const bd = document.getElementById('presetBackdrop');
          if (bd) bd.remove();
        }
      }
      return;
    }
    const group = e.target.closest('.chip-group');
    if (group) {
      group.querySelectorAll('.chip').forEach(c => c.classList.remove('is-active'));
      e.target.classList.add('is-active');
      
      // Xử lý chức năng chất lượng video
      if (e.target.textContent === '720p' || e.target.textContent === '1080p' || e.target.textContent === 'Auto (ABR)') {
        handleQualityChange(e.target.textContent);
      }
      
      // Xử lý chức năng Keyframe
      if (e.target.textContent === 'Keyframe') {
        handleKeyframeRequest();
      }
      
      // Xử lý chức năng Ghi MP4
      if (e.target.textContent === 'Ghi MP4') {
        handleRecordingToggle();
      }
    }
  }
  // nút chip fullscreen đã xóa; icon ở player vẫn giữ
});

// Pairing: tạo mã bảo mật 6 ký tự + timestamp
function generatePairCode(){
  const timestamp = Date.now().toString(36); // Thời gian hiện tại
  const random = Math.random().toString(36).substr(2, 4); // 4 ký tự random
  return (timestamp + random).substr(-6); // Lấy 6 ký tự cuối
}

// Tạo mã phòng bảo mật với thông tin đầy đủ
function generateSecureRoomCode() {
  const roomCode = generatePairCode();
  const roomData = {
    roomCode: roomCode,
    createdAt: Date.now(),
    expiresAt: Date.now() + (5 * 60 * 1000), // 5 phút
    used: false
  };
  return roomData;
}

function updateQRCode(data){
  const container = document.getElementById('qrContainer');
  if (!container) return;
  container.innerHTML = '';

  try {
    // Dùng QRCode.js (davidshimjs) đúng API
    /* global QRCode */
    new QRCode(container, {
      text: data,
      width: 160,
      height: 160,
      correctLevel: QRCode.CorrectLevel.M
    });
  } catch (err) {
    console.error('QR render failed:', err);
    const note = document.createElement('div');
    note.style.fontSize = '12px';
    note.style.opacity = '0.8';
    note.textContent = 'Không thể vẽ QR. Hiển thị mã 6 số để ghép.';
    container.appendChild(note);
  }
}

function initPairing(){
  const roomData = generateSecureRoomCode();
  window.__ROOM_DATA__ = roomData; // lưu tạm để dùng chỗ khác nếu cần
  
  // Gửi mã phòng lên server
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ 
      type: 'create-room', 
      roomCode: roomData.roomCode,
      createdAt: roomData.createdAt,
      expiresAt: roomData.expiresAt
    }));
  }
  
  // Cập nhật QR code với thông tin phòng
  updateQRCode(JSON.stringify({ 
    type: 'room', 
    roomCode: roomData.roomCode, 
    host: SERVER_HOST,
    expiresAt: roomData.expiresAt
  }));

  const btnShow = document.getElementById('btnShowCode');
  const wrap = document.getElementById('pairCodeWrap');
  const codeEl = document.getElementById('pairCode');
  const btnCopy = document.getElementById('btnCopyCode');

  if(btnShow){
    btnShow.addEventListener('click',()=>{
      wrap.classList.remove('hidden');
      codeEl.textContent = roomData.roomCode;
      
      // Hiển thị thời gian hết hạn
      const expiresIn = Math.ceil((roomData.expiresAt - Date.now()) / 1000);
      const timeEl = document.getElementById('roomExpires');
      if (timeEl) {
        timeEl.textContent = `Mã hết hạn sau: ${expiresIn} giây`;
      }
    });
  }
  if(btnCopy){
    btnCopy.addEventListener('click', async ()=>{
      try{ 
        await navigator.clipboard.writeText(roomData.roomCode); 
        btnCopy.textContent='Đã copy'; 
        setTimeout(()=>btnCopy.textContent='Copy',1200);
      }catch{}
    });
  }
  
  // Cập nhật thời gian hết hạn mỗi giây
  setInterval(() => {
    const timeEl = document.getElementById('roomExpires');
    if (timeEl && !wrap.classList.contains('hidden')) {
      const expiresIn = Math.ceil((roomData.expiresAt - Date.now()) / 1000);
      if (expiresIn > 0) {
        timeEl.textContent = `Mã hết hạn sau: ${expiresIn} giây`;
      } else {
        timeEl.textContent = 'Mã đã hết hạn!';
        wrap.classList.add('hidden');
      }
    }
  }, 1000);
}

// Auto Smart Cast (mock): đo 1s và chọn preset
function autoSmartCast(){
  // Giả lập: nếu băng thông ngẫu nhiên > 8 Mbps thì chọn 1080p, ngược lại 720p
  const estimatedMbps = Math.round((5 + Math.random()*10)*10)/10; // 5..15 Mbps
  const latencyMs = Math.round(100 + Math.random()*80); // 100..180 ms
  updateTelemetry(latencyMs, estimatedMbps, 60);

  const leftGroup = document.querySelector('.chip-group');
  if (!leftGroup) return;
  const chips = Array.from(leftGroup.querySelectorAll('.chip'));
  const targetText = estimatedMbps > 8 ? '1080p' : '720p';
  chips.forEach(c => {
    if (c.textContent.trim() === targetText) c.classList.add('is-active');
    else if (c.classList.contains('is-active')) c.classList.remove('is-active');
  });
}

function updateTelemetry(latency, mbps, fps){
  // Cập nhật 3 chip nổi góc phải nếu có
  const chips = document.querySelectorAll('.metrics-float .chip');
  if (chips.length >= 3){
    chips[0].textContent = `${latency} ms`;
    chips[1].textContent = `${mbps} Mbps`;
    chips[2].textContent = `${fps} FPS`;
  }
}

window.addEventListener('DOMContentLoaded', ()=>{
  initPairing();
  updateConnectionUI('disconnected'); // Khởi tạo trạng thái disconnected
  updateTelemetryDisplay(0, 0, 0); // Hiển thị 0 ngay từ đầu
  
  // Test fullscreen button
  const fullscreenBtn = document.getElementById('btnFullscreen');
  console.log('Fullscreen button found:', fullscreenBtn);
  if (fullscreenBtn) {
    console.log('✅ Nút fullscreen sẵn sàng để test!');
    // Nút fullscreen đã hoạt động bình thường
    // Visual feedback đã ẩn - nút fullscreen hoạt động bình thường
  } else {
    console.error('❌ Không tìm thấy nút fullscreen!');
  }
  
  // Kết nối signaling (tạm dùng sessionId cố định để test)
  connectSignaling('ABC123');
});

function toggleRoute(route){
  const isSettings = route === 'settings';
  const settings = document.querySelector('.settings-panel');
  const playerParts = document.querySelectorAll('.player-card,.chips-row,.inline-tip');
  if (settings) settings.style.display = isSettings ? 'block' : 'none';
  playerParts.forEach(el=>{ if(el) el.style.display = isSettings ? 'none' : ''; });
  // focus back link when mở settings
  if (isSettings){
    const back = document.getElementById('btnBackOverview');
    if (back) back.focus();
  }
}

// default route
window.addEventListener('DOMContentLoaded', ()=> toggleRoute('overview'));

// UI: cập nhật số hiển thị cho sliders và xử lý back
window.addEventListener('DOMContentLoaded', ()=>{
  const pairs = [
    ['micVol','micVolVal'],
    ['masterVol','masterVolVal'],
    ['brightness','brightnessVal']
  ];
  pairs.forEach(([id,vid])=>{
    const input = document.getElementById(id);
    const val = document.getElementById(vid);
    if (input && val){
      input.addEventListener('input', ()=> val.textContent = input.value);
    }
  });
  const back = document.getElementById('btnBackOverview');
  if (back){ back.addEventListener('click', ()=>{
    document.querySelector('.menu .item[data-route="overview"]').click();
  }); }
  const test = document.getElementById('btnTestNotify');
  if (test){ test.addEventListener('click', ()=> alert('Thông báo thử!')); }
  
  // Settings functionality
  initSettings();
  // chọn preset
  const menu = document.getElementById('presetMenu');
  const btn = document.getElementById('btnPreset');
  if (menu && btn){
    menu.addEventListener('click', (e)=>{
      const item = e.target.closest('.preset-item');
      if (!item) return;
      e.preventDefault();
      e.stopPropagation();
      // set visual selected
      menu.querySelectorAll('.preset-item').forEach(i=>i.classList.remove('is-selected'));
      item.classList.add('is-selected');
      const map = {
        'low-latency':'Độ trễ thấp',
        'high-detail':'Chi tiết cao',
        'bandwidth-save':'Tiết kiệm băng thông'
      };
      const key = item.getAttribute('data-preset');
      const label = map[key] || 'Preset';
      // cập nhật nhãn trực tiếp
      btn.textContent = label;
      btn.setAttribute('aria-label', label);
      btn.dataset.preset = key;
      localStorage.setItem('preset', key);
      menu.classList.add('hidden');
      const bd = document.getElementById('presetBackdrop');
      if (bd) bd.remove();
    });
    // khôi phục nhãn nếu đã chọn
    const saved = localStorage.getItem('preset');
    const map = { 'low-latency':'Độ trễ thấp','high-detail':'Chi tiết cao','bandwidth-save':'Tiết kiệm băng thông' };
    if (saved && map[saved]){ 
      btn.textContent = map[saved]; 
      btn.dataset.preset = saved; 
      const current = menu.querySelector(`.preset-item[data-preset="${saved}"]`);
      if (current) current.classList.add('is-selected');
    }
    // đóng khi click ngoài
    document.addEventListener('click', (e)=>{
      if (!menu.classList.contains('hidden')){
        if (!e.target.closest('#presetMenu') && !e.target.closest('#btnPreset')){
          menu.classList.add('hidden');
          const bd = document.getElementById('presetBackdrop');
          if (bd) bd.remove();
        }
      }
    });
  }
});

