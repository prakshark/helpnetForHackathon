const Hyperswarm = require('hyperswarm');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Create a new Hyperswarm instance
const swarm = new Hyperswarm();

// The topic for the swarm (hashed to a 32-byte Buffer)
const topic = crypto.createHash('sha256').update('helpnet-p2p').digest();

// Elements in the DOM
const sendMessageButton = document.getElementById('sendMessageButton');
const messageInput = document.getElementById('messageInput');
const messagesDiv = document.getElementById('messages');
const sendSOSButton = document.getElementById('sos');
const sendFileButton = document.getElementById('sendFileButton');
const survivorsCount = document.getElementById('survivors');
const checkInSafeButton = document.getElementById('checkInSafe');
const safeList = document.getElementById('safeList');

// Initialize map (Leaflet)
const map = L.map('map').setView([28.6139, 77.2089], 10); // Default to Noida
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

let userLocation = null;

// Create a custom check-in input dialog
function showCheckInDialog(callback) {
    const inputDiv = document.createElement('div');
    inputDiv.style.position = 'fixed';
    inputDiv.style.top = '50%';
    inputDiv.style.left = '50%';
    inputDiv.style.transform = 'translate(-50%, -50%)';
    inputDiv.style.background = '#fff';
    inputDiv.style.padding = '20px';
    inputDiv.style.boxShadow = '0 0 10px rgba(0, 0, 0, 0.5)';
    inputDiv.style.zIndex = '1000';

    const inputField = document.createElement('input');
    inputField.type = 'text';
    inputField.placeholder = 'Enter your name';
    inputField.style.width = '100%';
    inputField.style.marginBottom = '10px';

    const submitButton = document.createElement('button');
    submitButton.textContent = 'Submit';
    submitButton.style.marginRight = '10px';

    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'Cancel';

    inputDiv.appendChild(inputField);
    inputDiv.appendChild(submitButton);
    inputDiv.appendChild(cancelButton);
    document.body.appendChild(inputDiv);

    submitButton.addEventListener('click', () => {
        const name = inputField.value.trim();
        document.body.removeChild(inputDiv);
        callback(name);
    });

    cancelButton.addEventListener('click', () => {
        document.body.removeChild(inputDiv);
        callback(null);
    });
}

// Join the swarm
try {
    console.log(`Joining swarm with topic: ${topic.toString('hex')}`);
    swarm.join(topic, {
        lookup: true,
        announce: true,
    });

    swarm.on('connection', (peer, details) => {
        console.log('Connected to a peer:', details);

        peer.on('data', (data) => {
            const message = data.toString();
            console.log('Received message:', message);
            displayMessage(`Peer: ${message}`);

            // Handle safety check-in messages
            if (message.startsWith('SAFE:')) {
                const safeName = message.substring(5);
                addSafeUserToList(safeName);
            }

            // Handle file data
            if (message.startsWith('FILE:')) {
                const fileData = Buffer.from(message.substring(5), 'base64');
                saveReceivedFile(fileData, peer);
            }
        });

        peer.on('close', () => {
            console.log('Peer disconnected');
            updateSurvivorsOnlineCount();
        });

        updateSurvivorsOnlineCount();
    });

    sendMessageButton.addEventListener('click', () => {
        const message = messageInput.value.trim();
        if (message === '') return;

        console.log(`Sending message to peers: ${message}`);
        displayMessage(`You: ${message}`);

        swarm.connections.forEach((peer) => peer.write(message));
        messageInput.value = '';
    });

    sendSOSButton.addEventListener('click', () => {
        const sosMessage = 'IMMEDIATE EMERGENCY !!!';
        console.log(`Sending SOS message: ${sosMessage}`);

        swarm.connections.forEach((peer) => peer.write(sosMessage));
        displayMessage(`You: ${sosMessage}`);
    });

    sendFileButton.addEventListener('click', () => {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = '*'; // Accept any file type
        fileInput.click();

        fileInput.addEventListener('change', (event) => {
            const file = event.target.files[0];
            if (file) {
                console.log(`Sending file: ${file.name}`);
                const reader = new FileReader();
                reader.onload = () => {
                    const fileData = reader.result;
                    const fileMessage = `FILE:${fileData.toString('base64')}`;
                    swarm.connections.forEach((peer) => peer.write(fileMessage));
                    displayMessage(`You: File sent (${file.name})`);
                };
                reader.readAsArrayBuffer(file);
            }
        });
    });

    checkInSafeButton.addEventListener('click', () => {
        showCheckInDialog((name) => {
            if (!name) return; // User canceled or entered nothing
            const safeMessage = `SAFE:${name}`;
            console.log(`Checking in as safe: ${name}`);

            swarm.connections.forEach((peer) => peer.write(safeMessage));
            addSafeUserToList(name); // Add yourself to the safe list
        });
    });

    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                userLocation = { lat: position.coords.latitude, lng: position.coords.longitude };
                L.marker([userLocation.lat, userLocation.lng]).addTo(map).bindPopup('You are here!').openPopup();

                swarm.connections.forEach((peer) =>
                    peer.write(JSON.stringify(userLocation))
                );
            },
            (err) => {
                console.error('Error getting geolocation:', err);
                const fallbackLocation = { lat: 28.6139, lng: 77.2089 };
                userLocation = fallbackLocation;
                L.marker([fallbackLocation.lat, fallbackLocation.lng]).addTo(map).bindPopup('Here').openPopup();
            },
            { timeout: 10000, enableHighAccuracy: true, maximumAge: 0 }
        );
    } else {
        const fallbackLocation = { lat: 28.6139, lng: 77.2089 };
        userLocation = fallbackLocation;
        L.marker([fallbackLocation.lat, fallbackLocation.lng]).addTo(map).bindPopup('Here').openPopup();
    }
} catch (err) {
    console.error('Error setting up swarm:', err);
}

// Function to display messages in the UI
const MAX_MESSAGES = 50; // Limit to 50 messages

function displayMessage(message) {
    const messageElement = document.createElement('p');
    messageElement.textContent = message;
    const messagesDiv = document.getElementById('messages');
    messagesDiv.appendChild(messageElement);

    // Check if the number of child elements exceeds the maximum
    while (messagesDiv.childNodes.length > MAX_MESSAGES) {
        messagesDiv.removeChild(messagesDiv.firstChild); // Remove the oldest message
    }

    // Scroll to the bottom to show the latest message
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
}


// Function to update the survivors count
function updateSurvivorsOnlineCount() {
    const survivorsCountValue = swarm.connections.size;
    survivorsCount.textContent = survivorsCountValue;
}

// Function to add safe user to the list
function addSafeUserToList(name) {
    const listItem = document.createElement('li');
    listItem.textContent = name;
    safeList.appendChild(listItem);
}

// Function to save the received file
function saveReceivedFile(fileData, peer) {
    const filename = `received_file_${Date.now()}`;
    const filePath = path.join(__dirname, filename); // Local path where file will be saved

    fs.writeFile(filePath, fileData, (err) => {
        if (err) {
            console.error('Error saving file:', err);
            return;
        }
        console.log(`File received and saved: ${filename}`);

        // Display message in the chat
        displayMessage(`Received a file: ${filename}`);

        // Optionally, create a download link for the file
        const link = document.createElement('a');
        link.href = filePath; // Local file path
        link.download = filename;
        link.textContent = `Download ${filename}`;
        messagesDiv.appendChild(link);

        // If it's an image file, display it directly
        if (isImageFile(filePath)) {
            const imgElement = document.createElement('img');
            imgElement.src = filePath;
            imgElement.alt = 'Received Image';
            imgElement.style.maxWidth = '300px'; // Limit image size
            messagesDiv.appendChild(imgElement);
        }
    });
}

// Function to check if the file is an image
function isImageFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return ['.jpg', '.jpeg', '.png', '.gif', '.bmp'].includes(ext);
}

document.addEventListener("DOMContentLoaded", () => {
    const sendDoubtBtn = document.getElementById("sendDoubtBtn");
    const doubtInput = document.getElementById("doubtInput");
    const doubtMessagesDiv = document.getElementById("doubtMessagesDiv");

    sendDoubtBtn.addEventListener("click", async () => {
        const question = doubtInput.value.trim();
        if (!question) return;

        // Display user question
        displayDoubtMessage(`You: ${question}`);

        // Fetch response from API
        try {
            const response = await fetch(`https://doji-stage.azurewebsites.net/api/emer/?query=${encodeURIComponent(question)}`);
            const data = await response.json();

            if (data.response) {
                displayDoubtMessage(`Bot: ${data.response}`);
            } else {
                displayDoubtMessage("Bot: Sorry, I couldn't fetch an answer.");
            }
        } catch (error) {
            console.error("Error fetching answer:", error);
            displayDoubtMessage("Bot: An error occurred. Please try again.");
        }

        // Clear input field
        doubtInput.value = "";
    });

    function displayDoubtMessage(message) {
        const messageElement = document.createElement("p");
        messageElement.textContent = message;
        doubtMessagesDiv.appendChild(messageElement);

        // Auto-scroll to the latest message
        document.getElementById("doubtMessagesDiv").scrollTop = document.getElementById("doubtMessagesDiv").scrollHeight;
    }
});

document.getElementById("toggleDoubtBtn").addEventListener("click", function () {
    const doubtContainer = document.getElementById("askDoubtContainer");
    if (doubtContainer.style.display === "none" || doubtContainer.style.display === "") {
        doubtContainer.style.display = "block";
    } else {
        doubtContainer.style.display = "none";
    }
});

document.getElementById("toggleDoubtBtn").addEventListener("click", function () {
    document.getElementById("askDoubtContainer").style.display = "block";
});

document.getElementById("closeDoubtBtn").addEventListener("click", function () {
    document.getElementById("askDoubtContainer").style.display = "none";
});