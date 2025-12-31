const socket = io();
let myRole = "", myName = "", timerInt = null;
let myTimeExpired = false;

window.onload = () => {
    const savedName = localStorage.getItem('kviz_name');
    if (savedName) {
        document.getElementById('name-input').value = savedName;
    }
};

const join = () => {
    const name = document.getElementById('name-input').value;
    if(!name) return;
    localStorage.setItem('kviz_name', name);
    socket.emit('join', name);
};

const nextQ = () => socket.emit('start_game');
const reset = () => confirm("Resetirati kviz?") && socket.emit('reset_all');

const sendAns = () => {
    const val = document.getElementById('ans-input').value;
    if(!val) return;
    socket.emit('submit_answer', val);
    document.getElementById('p-input-area').classList.add('hidden');
    document.getElementById('p-wait-msg').innerHTML = "<h2>Odgovor poslan!</h2><p>Čekanje na ispravak...</p>";
    document.getElementById('p-wait-msg').classList.remove('hidden');
};

socket.on('role_assigned', d => {
    myRole = d.role; myName = d.name;
    document.getElementById('login-screen').classList.add('hidden');
    document.querySelectorAll('.container > div').forEach(div => div.classList.add('hidden'));
    document.getElementById(`${d.role.toLowerCase()}-screen`).classList.remove('hidden');
    if(myName) document.getElementById('p-name').innerText = myName;
});

socket.on('game_update', state => {
    const progressText = state.currentQuestionIndex >= 0 ? `Pitanje ${state.currentQuestionIndex + 1} / ${state.totalQuestions}` : "";

    if(myRole === 'DISPLAY') {
        const area = document.getElementById('display-area');
        const main = document.getElementById('display-main-msg');
        const timer = document.getElementById('timer-box');
        const prog = document.getElementById('q-progress');
        
        prog.innerText = progressText;

        if(state.status === 'LOBBY') {
            main.innerText = "PRIDRUŽITE SE KVIZU";
            timer.innerText = "";
        } else if(state.status === 'QUESTION') {
            main.innerText = state.currentQuestionText;
            if(!timerInt) startTimer(60);
            area.innerHTML = "";
        } else if(state.status === 'GRADING') {
            clearInterval(timerInt);
            timerInt = null;
            timer.innerText = "⌛";
            main.innerText = "ISPRAVLJANJE...";
        } else if(state.status === 'LEADERBOARD') {
            clearInterval(timerInt);
            timerInt = null;
            main.innerText = "TRENUTNI POREDAK";
            timer.innerText = "";
        } else if(state.status === 'FINISH') {
            clearInterval(timerInt);
            timerInt = null;
            main.innerText = "KRAJ KVIZA - KONAČNI REZULTATI";
            timer.innerText = "🏆";
            prog.innerText = "";
        }
    }

    if(myRole === 'PLAYER') {
        if(state.status === 'QUESTION') {
            document.getElementById('p-input-area').classList.remove('hidden');
            document.getElementById('p-wait-msg').classList.add('hidden');
            document.getElementById('p-q-title').innerText = progressText;
            myTimeExpired = false;
        } else if (state.status === 'LEADERBOARD' || state.status === 'FINISH') {
            document.getElementById('p-input-area').classList.add('hidden');
            document.getElementById('p-wait-msg').classList.remove('hidden');
            document.getElementById('p-wait-msg').innerHTML = "<h2>Pogledaj u ekran!</h2><p>Rezultati stižu...</p>";
        } else if (state.status === 'GRADING') {
            document.getElementById('p-input-area').classList.add('hidden');
            document.getElementById('p-wait-msg').classList.remove('hidden');
            document.getElementById('p-wait-msg').innerHTML = state.timerExpired ? "<h2>⏰ Vrijeme je isteklo!</h2>" : "<h2>Odgovor poslan!</h2>";
            document.getElementById('p-wait-msg').innerHTML += "<p>Čekanje na ispravak...</p>";
        }
    }

    if(myRole === 'SCORER') {
        const btn = document.getElementById('next-q-btn');
        btn.disabled = !(state.status === 'LOBBY' || state.status === 'LEADERBOARD');
        if(state.status === 'FINISH') btn.innerText = "KVIZ ZAVRŠEN";
        document.getElementById('csv-download-btn').style.display = (state.status === 'FINISH') ? 'inline-block' : 'none';
    }
});

socket.on('update_players', data => {
    const { db, online } = data;
    const players = Object.entries(db).sort((a,b) => b[1].score - a[1].score);
    
    // CSV FIX: Assign leaderboard data for ALL roles here
    window.leaderboardData = players;

    if(myRole === 'DISPLAY') {
        const area = document.getElementById('display-area');
        const mainMsg = document.getElementById('display-main-msg').innerText;
        
        if(mainMsg.includes("POREDAK") || mainMsg.includes("PRIDRUŽITE") || mainMsg.includes("KRAJ")) {
            area.innerHTML = players.map((p,i)=>`
                <div class="lb-row ${online[p[0]] ? '' : 'is-offline'} ${i === 0 && mainMsg.includes("KRAJ") ? 'winner' : ''}">
                    <span>${i+1}. ${p[0]}</span>
                    <span>${p[1].score}</span>
                </div>`).join('');
        }

        // FIX: Progress counter now uses total players in DB
        const subCount = players.filter(p=>p[1].hasSubmitted || p[1].isGraded).length;
        document.getElementById('sub-counter-area').innerText = (mainMsg.includes("?")) ? `Odgovora: ${subCount} / ${players.length}` : "";
    }

    if(myRole === 'SCORER') {
        document.getElementById('grading-list').innerHTML = players.filter(p=>p[1].hasSubmitted).map(p=>`
            <div class="player-card">
                <strong>${p[0]}</strong>: <span style="color:var(--primary)">${p[1].currentAnswer}</span><br><br>
                <div style="display:flex; gap:5px;">
                    <input type="number" step="0.5" id="pts-${p[0]}" value="1" style="width:70px">
                    <button onclick="socket.emit('assign_points', {name:'${p[0]}', points:document.getElementById('pts-${p[0]}').value})">OK</button>
                    <button class="danger" onclick="socket.emit('assign_points', {name:'${p[0]}', points:0})">0</button>
                </div>
            </div>`).join('');
        
        document.getElementById('scorer-player-list').innerHTML = players.map(p=>`
            <div class="player-card ${online[p[0]] ? '' : 'is-offline'}">
                <span class="status-dot ${online[p[0]] ? 'online' : 'offline'}"></span>
                <strong>${p[0]}</strong> [${p[1].score}] ${p[1].hasSubmitted ? '📩' : ''}
                <button onclick="socket.emit('kick_player','${p[0]}')" class="danger" style="float:right; padding:2px 8px;">X</button>
            </div>`).join('');
    }

    if(myRole === 'PLAYER' && db[myName]) {
        document.getElementById('p-score').innerText = `Bodovi: ${db[myName].score} (${db[myName].lastPoints >= 0 ? '+' : ''}${db[myName].lastPoints})`;
    }
});

function startTimer(sec) {
    clearInterval(timerInt);
    let t = sec;
    const box = document.getElementById('timer-box');
    box.classList.remove('timer-warning');
    box.innerText = t;
    timerInt = setInterval(() => {
        t--; 
        box.innerText = t;
        if(t <= 10) box.classList.add('timer-warning');
        if(t <= 0) {
            clearInterval(timerInt);
            timerInt = null;
            box.innerText = "KRAJ VREMENA";
        }
    }, 1000);
}

function downloadCSV() {
    if(!window.leaderboardData || window.leaderboardData.length === 0) return alert("Nema podataka!");
    let csvContent = "data:text/csv;charset=utf-8,Rang;Ime;Bodovi\n";
    window.leaderboardData.forEach((p, i) => {
        csvContent += `${i+1};${p[0]};${p[1].score}\n`;
    });
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "poredak_kviz.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}