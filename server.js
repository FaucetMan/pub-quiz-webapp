const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const ADMIN_CODE = "GLAVNI123";
const SCORER_CODE = "SUDAC123";
const DB_FILE = 'players.json';

let playersDatabase = fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE, 'utf-8')) : {};
let questions = [];
try {
    questions = fs.readFileSync('questions.txt', 'utf-8').split('\n').map(l => l.trim()).filter(l => l !== "");
} catch (e) { 
    questions = ["Testno pitanje 1?", "Testno pitanje 2?"]; 
}

let gameState = { 
    currentQuestionIndex: -1, 
    status: "LOBBY", 
    currentQuestionText: "",
    timerExpired: false,
    totalQuestions: questions.length
};

let onlineStatus = {};
let questionTimeout = null; // SERVER SIDE TIMER

app.use(express.static('public'));

const broadcastUpdates = () => {
    io.emit('update_players', { db: playersDatabase, online: onlineStatus });
};

const checkStateTransition = () => {
    const players = Object.values(playersDatabase);
    const totalPlayerCount = players.length; // Uses total registered, not just online
    
    const pendingCount = players.filter(p => p.hasSubmitted).length;
    const finishedCount = players.filter(p => (p.hasSubmitted || p.isGraded)).length;
    const allSubmitted = finishedCount >= totalPlayerCount && totalPlayerCount > 0;

    if ((gameState.timerExpired || allSubmitted) && pendingCount === 0) {
        clearTimeout(questionTimeout);
        if (gameState.currentQuestionIndex === questions.length - 1 && gameState.status === "GRADING") {
            gameState.status = "FINISH";
        } else {
            gameState.status = "LEADERBOARD";
        }
        io.emit('game_update', gameState);
    } else if ((gameState.timerExpired || allSubmitted) && pendingCount > 0) {
        gameState.status = "GRADING";
        io.emit('game_update', gameState);
    }
};

io.on('connection', (socket) => {
    socket.on('join', (name) => {
        if (name === ADMIN_CODE) {
            socket.emit('role_assigned', { role: 'DISPLAY' });
        } else if (name === SCORER_CODE) {
            socket.emit('role_assigned', { role: 'SCORER' });
        } else {
            // REJOIN FIX: Removed the "Ime je zauzeto" block to allow re-entry
            if (!playersDatabase[name]) {
                playersDatabase[name] = { name: name, score: 0, currentAnswer: "", hasSubmitted: false, isGraded: false, lastPoints: 0 };
            }
            onlineStatus[name] = true;
            socket.playerName = name;
            socket.emit('role_assigned', { role: 'PLAYER', name: name });
            fs.writeFile(DB_FILE, JSON.stringify(playersDatabase), (err) => {
                if (err) console.error('Error saving players:', err);
            });
        }
        socket.emit('game_update', gameState);
        broadcastUpdates();
    });

    socket.on('submit_answer', (ans) => {
        if (socket.playerName && playersDatabase[socket.playerName] && gameState.status === "QUESTION") {
            playersDatabase[socket.playerName].currentAnswer = ans;
            playersDatabase[socket.playerName].hasSubmitted = true;
            playersDatabase[socket.playerName].isGraded = false;
            checkStateTransition();
            broadcastUpdates();
        }
    });

    socket.on('assign_points', ({ name, points }) => {
        const pts = parseFloat(points) || 0;
        if (playersDatabase[name]) {
            playersDatabase[name].score = Math.round((playersDatabase[name].score + pts) * 100) / 100;
            playersDatabase[name].lastPoints = pts;
            playersDatabase[name].hasSubmitted = false;
            playersDatabase[name].isGraded = true; 
            checkStateTransition();
            fs.writeFile(DB_FILE, JSON.stringify(playersDatabase), (err) => {
                if (err) console.error('Error saving players:', err);
            });
            broadcastUpdates();
        }
    });

    // Modified times_up to be callable by server or client safely
    const handleTimesUp = () => {
        if (gameState.status !== "QUESTION") return;
        gameState.timerExpired = true;
        Object.keys(playersDatabase).forEach(name => {
            if (!playersDatabase[name].hasSubmitted && !playersDatabase[name].isGraded) {
                playersDatabase[name].currentAnswer = "ISTEKLO VRIJEME";
                playersDatabase[name].hasSubmitted = true;
            }
        });
        checkStateTransition();
        broadcastUpdates();
    };

    socket.on('times_up', handleTimesUp);

    socket.on('start_game', () => {
        if (gameState.status === "LOBBY" || gameState.status === "LEADERBOARD") {
            gameState.currentQuestionIndex++;
            if (gameState.currentQuestionIndex < questions.length) {
                gameState.status = "QUESTION";
                gameState.timerExpired = false;
                gameState.currentQuestionText = questions[gameState.currentQuestionIndex];
                Object.keys(playersDatabase).forEach(p => { 
                    playersDatabase[p].hasSubmitted = false; 
                    playersDatabase[p].isGraded = false;
                    playersDatabase[p].currentAnswer = "";
                });
                
                // START SERVER TIMER (60s + 2s buffer for network)
                clearTimeout(questionTimeout);
                questionTimeout = setTimeout(handleTimesUp, 62000);

                io.emit('game_update', gameState);
                broadcastUpdates();
            } else {
                gameState.status = "FINISH";
                io.emit('game_update', gameState);
            }
        }
    });

    socket.on('reset_all', () => {
        playersDatabase = {};
        clearTimeout(questionTimeout);
        gameState = { currentQuestionIndex: -1, status: "LOBBY", currentQuestionText: "", timerExpired: false, totalQuestions: questions.length };
        fs.writeFile(DB_FILE, JSON.stringify(playersDatabase), (err) => {
            if (err) console.error('Error saving players:', err);
        });
        io.emit('game_update', gameState);
        broadcastUpdates();
    });

    socket.on('kick_player', (name) => {
        delete playersDatabase[name];
        delete onlineStatus[name];
        broadcastUpdates();
        checkStateTransition();
    });

    socket.on('disconnect', () => {
        if (socket.playerName) {
            delete onlineStatus[socket.playerName];
            broadcastUpdates();
            // We no longer trigger checkStateTransition on disconnect 
            // to prevent the game ending just because someone crashed.
        }
    });
});

server.listen(3000, '0.0.0.0', () => console.log('Server radi na portu 3000'));