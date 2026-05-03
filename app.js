const socket = io();

// UI Elements
const startBtn = document.getElementById('start-btn');
const statusText = document.getElementById('status-text');
const swipeCard = document.getElementById('swipe-card');
const swipeOverlay = document.getElementById('swipe-overlay');
const videoContainer = document.getElementById('video-container');
const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');
const controls = document.getElementById('controls');
const nextBtn = document.getElementById('next-btn');
const toggleMicBtn = document.getElementById('toggle-mic-btn');
const toggleCamBtn = document.getElementById('toggle-cam-btn');

let isSearching = false;
let localStream = null;
let peerConnection = null;
let currentPeerId = null;

const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// --- INITIALISATION MEDIA ---
async function initMedia() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
        localVideo.classList.remove('hidden');
        return true;
    } catch (err) {
        console.error("Erreur accès caméra :", err);
        alert("Veuillez autoriser l'accès à la caméra et au micro.");
        return false;
    }
}

// --- LOGIQUE SWIPE CARTE ---
let startX = 0;
let currentX = 0;
let isDraggingCard = false;

if (swipeCard) {
    const handleTouchStart = (e) => {
        startX = e.touches ? e.touches[0].clientX : e.clientX;
        currentX = startX;
        isDraggingCard = true;
        swipeCard.style.transition = 'none';
    };

    const handleTouchMove = (e) => {
        if (!isDraggingCard) return;
        currentX = e.touches ? e.touches[0].clientX : e.clientX;
        const deltaX = currentX - startX;
        const rotation = deltaX * 0.05;
        
        swipeCard.style.transform = `translateX(${deltaX}px) rotate(${rotation}deg)`;
        
        if (deltaX > 30) swipeCard.style.boxShadow = '0 20px 40px rgba(0,230,118,0.3)';
        else if (deltaX < -30) swipeCard.style.boxShadow = '0 20px 40px rgba(255,0,0,0.3)';
    };

    const handleTouchEnd = async (e) => {
        if (!isDraggingCard) return;
        isDraggingCard = false;
        const deltaX = currentX - startX;
        swipeCard.style.transition = 'transform 0.4s ease-out, opacity 0.4s ease-out, box-shadow 0.3s ease';

        if (deltaX > 30) {
            swipeCard.style.transform = `translateX(150vw) rotate(30deg)`;
            swipeCard.style.opacity = 0;
            statusText.classList.remove('hidden'); // Affiche Recherche immédiatement
            
            if (!localStream) {
                const success = await initMedia();
                if (!success) {
                    swipeCard.style.transform = `translateX(0) rotate(0)`;
                    swipeCard.style.opacity = 1;
                    statusText.classList.add('hidden');
                    return;
                }
            }
            
            setTimeout(() => {
                swipeCard.classList.add('hidden');
                startSearching();
            }, 400);
        } else if (deltaX < -30) {
            swipeCard.style.transform = `translateX(-150vw) rotate(-30deg)`;
            swipeCard.style.opacity = 0;
            setTimeout(() => {
                swipeCard.style.transition = 'none';
                swipeCard.style.transform = `translateX(0) rotate(0)`;
                swipeCard.style.opacity = 1;
                swipeCard.style.boxShadow = '';
            }, 400);
        } else {
            swipeCard.style.transform = `translateX(0) rotate(0)`;
            swipeCard.style.boxShadow = '';
        }
    };

    swipeCard.addEventListener('touchstart', handleTouchStart);
    swipeCard.addEventListener('touchmove', handleTouchMove);
    swipeCard.addEventListener('touchend', handleTouchEnd);
    
    swipeCard.addEventListener('mousedown', handleTouchStart);
    window.addEventListener('mousemove', handleTouchMove);
    window.addEventListener('mouseup', handleTouchEnd);
}

startBtn.addEventListener('click', async () => {
    swipeCard.classList.add('hidden');
    statusText.classList.remove('hidden'); // Affiche Recherche immédiatement
    
    if (!localStream) {
        const success = await initMedia();
        if (!success) {
            swipeCard.classList.remove('hidden');
            statusText.classList.add('hidden');
            return;
        }
    }
    startSearching();
});

function startSearching() {
    if (isSearching) return;
    isSearching = true;
    statusText.classList.remove('hidden');
    socket.emit('join_queue');
}

// --- LOGIQUE SWIPE ÉCRAN (POUR PASSER) ---
let callStartX = 0;
let callCurrentX = 0;
let isDraggingCall = false;

videoContainer.addEventListener('touchstart', (e) => {
    if ((!currentPeerId && !isSearching) || e.target.closest('#swipe-card')) return;
    callStartX = e.touches[0].clientX;
    isDraggingCall = true;
    remoteVideo.style.transition = 'none';
});

videoContainer.addEventListener('touchmove', (e) => {
    if (!isDraggingCall) return;
    callCurrentX = e.touches[0].clientX;
    const deltaX = callCurrentX - callStartX;
    if (deltaX < 0 && currentPeerId) {
        remoteVideo.style.transform = `translateX(${deltaX}px)`;
    }
});

videoContainer.addEventListener('touchend', (e) => {
    if (!isDraggingCall) return;
    isDraggingCall = false;
    const deltaX = callCurrentX - callStartX;
    
    if (deltaX < -100 && (currentPeerId || isSearching)) {
        if (currentPeerId) {
            remoteVideo.style.transition = 'transform 0.3s ease-out';
            remoteVideo.style.transform = `translateX(-100vw)`;
            setTimeout(() => {
                remoteVideo.style.transition = 'none';
                remoteVideo.style.transform = `translateX(0)`;
                handleNextUser();
            }, 300);
        } else {
            handleNextUser();
        }
    } else if (currentPeerId) {
        remoteVideo.style.transition = 'transform 0.3s ease-out';
        remoteVideo.style.transform = `translateX(0)`;
    }
});

nextBtn.addEventListener('click', handleNextUser);

function handleNextUser() {
    closeConnection();
    socket.emit('leave_room');
    socket.emit('leave_queue');
    swipeOverlay.classList.remove('hidden');
    controls.classList.add('hidden');
    startSearching();
}

// --- WEBRTC CONNECTION P2P ---
function createPeerConnection() {
    peerConnection = new RTCPeerConnection(rtcConfig);
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    peerConnection.ontrack = (event) => {
        if (remoteVideo.srcObject !== event.streams[0]) {
            remoteVideo.srcObject = event.streams[0];
            remoteVideo.play().catch(e => console.error(e));
        }
    };

    peerConnection.onicecandidate = (event) => {
        if (event.candidate && currentPeerId) {
            socket.emit('webrtc_ice_candidate', { to: currentPeerId, candidate: event.candidate });
        }
    };
}

function closeConnection() {
    if (peerConnection) {
        peerConnection.close();
        peerConnection = null;
    }
    remoteVideo.srcObject = null;
    currentPeerId = null;
    isSearching = false;
}

socket.on('match_found', async (data) => {
    console.log("Match trouvé avec un utilisateur réel !");
    isSearching = false;
    currentPeerId = data.peerId;
    
    statusText.classList.add('hidden');
    swipeOverlay.classList.add('hidden');
    controls.classList.remove('hidden');
    
    remoteVideo.style.transition = 'none';
    remoteVideo.style.transform = `translateX(0)`;
    
    createPeerConnection();

    if (data.initiator) {
        try {
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            socket.emit('webrtc_offer', { to: currentPeerId, offer: offer });
        } catch (error) { console.error("Erreur offre", error); }
    }
});

socket.on('webrtc_offer', async (data) => {
    if (!peerConnection) createPeerConnection();
    try {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit('webrtc_answer', { to: data.from, answer: answer });
    } catch (error) { console.error("Erreur réception offre", error); }
});

socket.on('webrtc_answer', async (data) => {
    try { await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer)); } 
    catch (error) { console.error("Erreur réception réponse", error); }
});

socket.on('webrtc_ice_candidate', async (data) => {
    try { if (peerConnection) await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate)); } 
    catch (error) { console.error("Erreur ICE", error); }
});

socket.on('peer_disconnected', () => {
    console.log("Partenaire déconnecté");
    remoteVideo.style.transition = 'opacity 0.3s ease';
    remoteVideo.style.opacity = 0;
    
    setTimeout(() => {
        remoteVideo.style.transition = 'none';
        remoteVideo.style.opacity = 1;
        handleNextUser();
    }, 300);
});

// --- TOGGLES MEDIA ---
let camEnabled = true;
toggleCamBtn.addEventListener('click', () => {
    camEnabled = !camEnabled;
    if (localStream) localStream.getVideoTracks()[0].enabled = camEnabled;
    toggleCamBtn.classList.toggle('muted', !camEnabled);
    toggleCamBtn.innerHTML = camEnabled ? '<i class="fas fa-video"></i>' : '<i class="fas fa-video-slash"></i>';
});

let micEnabled = true;
toggleMicBtn.addEventListener('click', () => {
    micEnabled = !micEnabled;
    if (localStream) localStream.getAudioTracks()[0].enabled = micEnabled;
    toggleMicBtn.classList.toggle('muted', !micEnabled);
    toggleMicBtn.innerHTML = micEnabled ? '<i class="fas fa-microphone"></i>' : '<i class="fas fa-microphone-slash"></i>';
});
