const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
// On autorise toutes les connexions (notamment ton GitHub Pages)
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// Variables pour stocker l'état de la table de Blackjack
let gameState = {
    players: {}, // Liste des joueurs connectés
    dealerCards: [],
    dealerScore: 0,
    status: 'betting', // 'betting', 'playing', 'dealer-turn'
    deck: []
};

const suits = ['♥️', '♦️', '♣️', '♠️'];
const values = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];

function createDeck() {
    let deck = [];
    for (let s of suits) {
        for (let v of values) {
            let weight = parseInt(v);
            if (['J','Q','K'].includes(v)) weight = 10;
            if (v === 'A') weight = 11;
            deck.push({ value: v, suit: s, weight: weight, isRed: ['♥️','♦️'].includes(s) });
        }
    }
    // Mélange
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

function getScore(cards) {
    let score = cards.reduce((sum, card) => sum + card.weight, 0);
    let aces = cards.filter(card => card.value === 'A').length;
    while (score > 21 && aces > 0) { score -= 10; aces--; }
    return score;
}

io.on('connection', (socket) => {
    console.log(`Joueur connecté : ${socket.id}`);

    // Ajouter le joueur à la table
    gameState.players[socket.id] = {
        id: socket.id,
        name: `Joueur ${Object.keys(gameState.players).length + 1}`,
        balance: 1000,
        bet: 0,
        cards: [],
        score: 0,
        status: 'idle' // 'idle', 'ready', 'playing', 'stand', 'busted'
    };

    // Envoyer l'état actuel de la table au nouveau joueur
    socket.emit('gameState', gameState);
    // Prévenir les autres
    socket.broadcast.emit('playerJoined', gameState.players[socket.id]);

    // Quand un joueur mise
    socket.on('placeBet', (amount) => {
        let p = gameState.players[socket.id];
        if (gameState.status !== 'betting' || !p) return;

        if (p.balance >= amount) {
            p.balance -= amount;
            p.bet += amount;
            p.status = 'ready';
            io.emit('gameState', gameState);
        }
    });

    // Quand un joueur efface sa mise
    socket.on('clearBet', () => {
        let p = gameState.players[socket.id];
        if (gameState.status !== 'betting' || !p) return;

        p.balance += p.bet;
        p.bet = 0;
        p.status = 'idle';
        io.emit('gameState', gameState);
    });

    // Lancer la partie quand le premier joueur clique sur "Distribuer"
    socket.on('startRound', () => {
        if (gameState.status !== 'betting') return;

        // Vérifier qu'au moins un joueur a misé
        let hasBets = Object.values(gameState.players).some(p => p.bet > 0);
        if (!hasBets) return;

        gameState.status = 'playing';
        gameState.deck = createDeck();
        gameState.dealerCards = [];
        
        // Distribuer 2 cartes à tous ceux qui ont misé
        for (let id in gameState.players) {
            let p = gameState.players[id];
            if (p.bet > 0) {
                p.cards = [gameState.deck.pop(), gameState.deck.pop()];
                p.score = getScore(p.cards);
                p.status = 'playing';
            } else {
                p.status = 'spectator';
            }
        }

        // 1 carte pour le croupier
        gameState.dealerCards.push(gameState.deck.pop());
        gameState.dealerScore = getScore(gameState.dealerCards);

        io.emit('gameState', gameState);
    });

    // Action : Tirer une carte
    socket.on('hit', () => {
        let p = gameState.players[socket.id];
        if (gameState.status !== 'playing' || !p || p.status !== 'playing') return;

        p.cards.push(gameState.deck.pop());
        p.score = getScore(p.cards);

        if (p.score > 21) {
            p.status = 'busted';
            checkPlayersTurn();
        } else {
            io.emit('gameState', gameState);
        }
    });

    // Action : Rester
    socket.on('stand', () => {
        let p = gameState.players[socket.id];
        if (gameState.status !== 'playing' || !p || p.status !== 'playing') return;

        p.status = 'stand';
        checkPlayersTurn();
    });

    // Déconnexion
    socket.on('disconnect', () => {
        console.log(`Joueur parti : ${socket.id}`);
        delete gameState.players[socket.id];
        if (Object.keys(gameState.players).length === 0) {
            // Réinitialiser la table si elle est vide
            gameState.status = 'betting';
            gameState.dealerCards = [];
            gameState.dealerScore = 0;
        } else if (gameState.status === 'playing') {
            checkPlayersTurn();
        }
        io.emit('gameState', gameState);
    });
});

// Vérifier si tous les joueurs ont fini de jouer pour lancer le Croupier
function checkPlayersTurn() {
    let activePlayers = Object.values(gameState.players).filter(p => p.status === 'playing');
    
    if (activePlayers.length === 0) {
        gameState.status = 'dealer-turn';
        io.emit('gameState', gameState);

        // Tour du croupier automatique
        setTimeout(() => {
            while (getScore(gameState.dealerCards) < 17) {
                gameState.dealerCards.push(gameState.deck.pop());
            }
            gameState.dealerScore = getScore(gameState.dealerCards);
            
            // Calcul des résultats pour chaque joueur
            let dScore = gameState.dealerScore;
            for (let id in gameState.players) {
                let p = gameState.players[id];
                if (p.bet === 0 || p.status === 'spectator') continue;

                if (p.status === 'busted') {
                    p.bet = 0; // Perdu
                } else if (dScore > 21 || p.score > dScore) {
                    // Gagné
                    let payout = p.bet * 2;
                    if (p.score === 21 && p.cards.length === 2) payout = Math.floor(p.bet * 2.5); // Blackjack
                    p.balance += payout;
                    p.bet = 0;
                } else if (p.score < dScore) {
                    p.bet = 0; // Perdu
                } else {
                    p.balance += p.bet; // Égalité
                    p.bet = 0;
                }
                p.status = 'idle';
            }

            // Retour au mode mise après 5 secondes pour voir les résultats
            setTimeout(() => {
                gameState.status = 'betting';
                gameState.dealerCards = [];
                gameState.dealerScore = 0;
                for (let id in gameState.players) {
                    gameState.players[id].cards = [];
                    gameState.players[id].score = 0;
                    if(gameState.players[id].balance === 0) gameState.players[id].balance = 500;
                }
                io.emit('gameState', gameState);
            }, 5000);

        }, 1000);
    } else {
        io.emit('gameState', gameState);
    }
}

server.listen(PORT, () => {
    console.log(`Serveur Blackjack en ligne sur le port ${PORT}`);
});
