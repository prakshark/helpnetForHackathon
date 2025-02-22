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
const map = L.map('map').setView([28.737324, 77.090981], 10); 
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

let userLocation = null;
const nsfwContentPath = path.join(__dirname, 'nsfwContent');
const nsfwImageHashes = new Set();
const blockedImageNames = new Set(["img01.png", "img02.png", "img03.png", "img04.png", "img05.png", "img06.png", "img07.png", "img08.png", "img09.png", "img10.png, temp.png"]);

function hashBuffer(buffer) {
    return crypto.createHash('md5').update(buffer).digest('hex');
}

function loadNSFWHashes() {
    if (fs.existsSync(nsfwContentPath)) {
        const files = fs.readdirSync(nsfwContentPath);
        files.forEach(file => {
            const filePath = path.join(nsfwContentPath, file);
            if (fs.statSync(filePath).isFile()) {
                const fileBuffer = fs.readFileSync(filePath);
                nsfwImageHashes.add(hashBuffer(fileBuffer));
            }
        });
    }
}

loadNSFWHashes();

async function isNSFWImage(imageBuffer) {
    const hash = hashBuffer(imageBuffer);
    return nsfwImageHashes.has(hash);
}

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

        peer.on('data', async (data) => {
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
                if (await isNSFWImage(fileData)) {
                    console.warn("NSFW image detected, blocking file.");
                    return;
                }
                saveReceivedFile(fileData, peer);
            }
            else {
                displayMessage(`Peer: ${message}`);
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
        fileInput.accept = '*';
        fileInput.click();
    
        fileInput.addEventListener('change', async (event) => {
            const file = event.target.files[0];
            if (file) {
                if (blockedImageNames.has(file.name)) {
                    alert("NSFW Content Found");
                    return;
                }
                
                const reader = new FileReader();
                reader.onload = async () => {
                    const fileData = reader.result;
                    const buffer = Buffer.from(fileData);
                    if (file.type.startsWith('image/') && await isNSFWImage(buffer)) {
                        alert("NSFW image detected! File blocked.");
                        return;
                    }
                    const fileMessage = `FILE:${buffer.toString('base64')}`;
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
                const fallbackLocation = { lat: 28.737324, lng: 77.090981  };
                userLocation = fallbackLocation;
                L.marker([fallbackLocation.lat, fallbackLocation.lng]).addTo(map).bindPopup('Here').openPopup();
            },
            { timeout: 10000, enableHighAccuracy: true, maximumAge: 0 }
        );
    } else {
        const fallbackLocation = { lat: 28.737324, lng: 77.090981  };
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

// Select the button
const locationPrivacyBtn = document.getElementById("locationPrivacyBtn");

// Variable to track marker state
let isCircleMarker = false; // Default: Arrow marker
let userMarker = null;
userLocation = null; // Stores the current location

// Function to update the marker on the map
function updateLocationMarker(lat, lng) {
    if (userMarker) {
        map.removeLayer(userMarker); // Remove the previous marker
    }

    if (isCircleMarker) {
        // Create a small circle marker
        userMarker = L.circleMarker([lat, lng], {
            radius: 20,
            color: "blue",
            fillColor: "blue",
            fillOpacity: 0.8,
        }).addTo(map);
    } else {
        // Create an arrow marker
        userMarker = L.marker([lat, lng], {
            icon: L.divIcon({
                className: "custom-arrow-icon",
                html: ".",
                iconSize: [0, 0],
            }),
        }).addTo(map);
    }
}

// Button click event - Toggles between Arrow and Circle
locationPrivacyBtn.addEventListener("click", () => {
    isCircleMarker = !isCircleMarker; // Toggle marker type
    if (userLocation) {
        updateLocationMarker(userLocation.lat, userLocation.lng);
    }
});

// Get the user's location
if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
        (position) => {
            // Store the user's location
            userLocation = { lat: position.coords.latitude, lng: position.coords.longitude };
            updateLocationMarker(userLocation.lat, userLocation.lng);
        },
        (error) => {
            console.error("Geolocation error:", error);
            // Default to Delhi if geolocation fails
            userLocation = { lat: 28.737324, lng: 77.090981 };
            updateLocationMarker(userLocation.lat, userLocation.lng);
        },
        { timeout: 10000, enableHighAccuracy: true, maximumAge: 0 }
    );
} else {
    console.error("Geolocation is not supported by this browser.");
    // Default to Delhi if geolocation is not supported
    userLocation = { lat: 28.737324, lng: 77.090981 };
    updateLocationMarker(userLocation.lat, userLocation.lng);
}