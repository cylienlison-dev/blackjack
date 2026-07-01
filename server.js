// server.js - Version sécurisée et corrigée
const io = require('socket.io')(10000, { cors: { origin: "*" } });
let players = {};
let dealerHand = [];
let gameStatus = 'betting'; // 'betting', 'playing', 'dealerTurn'

function calculateScore(hand) {
    let score = 0, aces = 0;
    hand.forEach(c => {
        if (['J', 'Q', 'K'].includes(c.value)) score += 10;
        else if (c.value === 'A') { score += 11; aces++; }
        else score += parseInt(c.value);
    });
    while (score > 21 && aces > 0) { score -= 10; aces--; }
    return score;
}

function sendGameState() {
    let state = { status: gameStatus, dealerScore: 0, dealerCards: [], players: {} };
    
    // Cacher les cartes du croupier tant que le jeu n'est pas fini
    if (gameStatus === 'dealerTurn') {
        state.dealerCards = dealerHand;
        state.dealerScore = calculateScore(dealerHand);
    } else {
        state.dealerCards = dealerHand.length > 0 ? [dealerHand[0], {value:'?', suit:'?'}] : [];
    }

    // Envoyer les données aux joueurs
    for (let id in players) {
        state.players[id] = {
            id: id,
            name: players[id].name,
            cards: players[id].cards,
            score: calculateScore(players[id].cards),
            bet: players[id].bet,
            status: players[id].status
        };
    }
    io.emit('gameState', state);
}

io.on('connection', (socket) => {
    players[socket.id] = { name: "Joueur " + Object.keys(players).length, cards: [], bet: 0, status: 'waiting' };
    
    socket.on('placeBet', (amount) => {
        if (gameStatus === 'betting') players[socket.id].bet += amount;
        sendGameState();
    });

    socket.on('startRound', () => {
        if (gameStatus !== 'betting') return;
        gameStatus = 'playing';
        // Distribution simple... (ajouter ta logique de deck ici)
        sendGameState();
    });

    // ... (Ajoute ici tes fonctions hit/stand)
});
