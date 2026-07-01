const io = require("socket.io")(10000, { cors: { origin: "*" } });

let players = {};
let dealerHand = [];
let deck = [];
let gameStatus = 'betting';

const suits = ['♠', '♥', '♦', '♣'];
const values = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];

function buildDeck() {
    deck = [];
    for (let s of suits) { for (let v of values) { deck.push({ value: v, suit: s, isRed: (s === '♥' || s === '♦') }); } }
    for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
}

function getCardValue(card) {
    if (['J', 'Q', 'K'].includes(card.value)) return 10;
    if (card.value === 'A') return 11;
    return parseInt(card.value);
}

function calculateScore(hand) {
    let score = 0, aces = 0;
    hand.forEach(c => { score += getCardValue(c); if (c.value === 'A') aces++; });
    while (score > 21 && aces > 0) { score -= 10; aces--; }
    return score;
}

function sendGameState() {
    let state = {
        status: gameStatus,
        dealerScore: (gameStatus === 'dealerTurn') ? calculateScore(dealerHand) : 0,
        dealerCards: (gameStatus === 'dealerTurn') ? dealerHand : (dealerHand.length > 0 ? [dealerHand[0], {value:'?', suit:'?'}] : []),
        players: players
    };
    io.emit('gameState', state);
}

io.on('connection', (socket) => {
    // Initialisation du joueur avec un nom par défaut
    players[socket.id] = { id: socket.id, name: "Anonyme", cards: [], bet: 0, status: 'waiting', balance: 1000 };
    
    socket.on('setPseudo', (pseudo) => {
        if (players[socket.id]) {
            players[socket.id].name = pseudo.substring(0, 10); // Limité à 10 caractères
            sendGameState();
        }
    });

    socket.on('disconnect', () => { delete players[socket.id]; sendGameState(); });

    socket.on('placeBet', (amount) => {
        if (gameStatus === 'betting' && players[socket.id].balance >= amount) {
            players[socket.id].bet += amount;
            players[socket.id].balance -= amount;
            sendGameState();
        }
    });

    socket.on('clearBet', () => {
        if (gameStatus === 'betting') {
            players[socket.id].balance += players[socket.id].bet;
            players[socket.id].bet = 0;
            sendGameState();
        }
    });

    socket.on('startRound', () => {
        if (gameStatus === 'betting') {
            gameStatus = 'playing';
            buildDeck();
            Object.values(players).forEach(p => {
                if (p.bet > 0) { p.cards = [deck.pop(), deck.pop()]; p.status = 'playing'; }
            });
            dealerHand = [deck.pop(), deck.pop()];
            sendGameState();
        }
    });

    socket.on('hit', () => {
        if (gameStatus === 'playing' && players[socket.id]?.status === 'playing') {
            players[socket.id].cards.push(deck.pop());
            if (calculateScore(players[socket.id].cards) >= 21) players[socket.id].status = 'finished';
            sendGameState();
        }
    });

    socket.on('stand', () => {
        if (gameStatus === 'playing') {
            players[socket.id].status = 'finished';
            if (Object.values(players).every(p => p.bet === 0 || p.status === 'finished')) {
                gameStatus = 'dealerTurn';
                while (calculateScore(dealerHand) < 17) dealerHand.push(deck.pop());
                let dScore = calculateScore(dealerHand);
                Object.values(players).forEach(p => {
                    if (p.bet > 0) {
                        let pScore = calculateScore(p.cards);
                        if (pScore <= 21 && (dScore > 21 || pScore > dScore)) p.balance += p.bet * 2;
                        else if (pScore <= 21 && pScore === dScore) p.balance += p.bet;
                        p.bet = 0; p.cards = []; p.status = 'waiting';
                    }
                });
                gameStatus = 'betting';
            }
            sendGameState();
        }
    });
});
