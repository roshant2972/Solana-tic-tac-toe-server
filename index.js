import dotenv from "dotenv";
dotenv.config();
import bs58 from "bs58";
import express from "express";
import http from "http";
import WebSocket from "ws";
import { v4 as uuidv4 } from "uuid";
import * as solanaWeb3 from "@solana/web3.js";


const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ✅ Solana Setup
const connection = new solanaWeb3.Connection("https://solana-devnet.g.alchemy.com/v2/goCbNdCBRn-4sL01TfnJ_Yz7GB_5XmLl","confirmed");

let escrowKeypair;

try {
  const escrowSecretKey = bs58.decode(process.env.ESCROW_PRIVATE_KEY);
  escrowKeypair = solanaWeb3.Keypair.fromSecretKey(escrowSecretKey);
  console.log("Escrow Public Key:", escrowKeypair.publicKey.toBase58());
} catch (error) {
  console.error("Invalid or missing ESCROW_PRIVATE_KEY:", error.message);
  process.exit(1); // Stop server if private key is invalid
}

let activeRoom = null;
let bets = {}; // { playerId: amountInLamports }

wss.on("connection", (ws) => {
  ws.id = uuidv4();
  console.log(`User ${ws.id} connected`);

  ws.on("message", async (message) => {
    const data = JSON.parse(message);

    if (data.type === "createRoom") {
      if (!activeRoom) {
        activeRoom = {
          id: "TIC-TAC-ROOM",
          players: {},
          board: Array(9).fill(null),
          currentPlayer: "X",
          wins: { X: 0, O: 0 },
        };
        console.log("Room created");
      }

      ws.roomId = activeRoom.id;
      const symbol = Object.keys(activeRoom.players).length === 0 ? "X" : "O";
      activeRoom.players[ws.id] = {
        symbol,
        ws,
        pubkey: data.pubkey,
        bet: parseFloat(data.bet),
      };

      bets[ws.id] = solanaWeb3.LAMPORTS_PER_SOL * parseFloat(data.bet);

      ws.send(JSON.stringify({ type: "roomCreated", roomId: activeRoom.id, player: symbol }));
      broadcastRoomState(activeRoom.id);
    }

    if (data.type === "makeMove" && ws.roomId) {
      const { index, player } = data;
      if (
        activeRoom.players[ws.id].symbol === player &&
        player === activeRoom.currentPlayer &&
        !activeRoom.board[index]
      ) {
        activeRoom.board[index] = player;
        activeRoom.currentPlayer = player === "X" ? "O" : "X";
        broadcastRoomState(activeRoom.id);
        await checkWinner(activeRoom.id);
      }
    }
  });

  ws.on("close", () => {
    if (ws.roomId && activeRoom) {
      delete activeRoom.players[ws.id];
      delete bets[ws.id];
      if (Object.keys(activeRoom.players).length === 0) {
        activeRoom = null;
      } else {
        broadcastRoomState(activeRoom.id);
      }
    }
    console.log(`User ${ws.id} disconnected`);
  });
});

function broadcastRoomState(roomId) {
  if (!activeRoom) return;
  wss.clients.forEach((client) => {
    if (client.roomId === roomId && client.readyState === WebSocket.OPEN) {
      client.send(
        JSON.stringify({
          type: "updateBoard",
          board: activeRoom.board,
          currentPlayer: activeRoom.currentPlayer,
          wins: activeRoom.wins,
        })
      );
    }
  });
}

async function checkWinner(roomId) {
  const board = activeRoom.board;
  const combos = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6],
  ];

  for (const [a, b, c] of combos) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      const winnerSymbol = board[a];
      activeRoom.wins[winnerSymbol]++;
      try {
        await sendPrizeToWinner(winnerSymbol); // Attempt prize transfer
      } catch (error) {
        console.error("Error in sendPrizeToWinner:", error.message);
      }
      broadcastGameOver(roomId, winnerSymbol);
      resetGame(roomId);
      return;
    }
  }

  if (board.every(cell => cell !== null)) {
    broadcastGameOver(roomId, "draw");
    resetGame(roomId);
  }
}
function broadcastGameOver(roomId, winner) {
  wss.clients.forEach((client) => {
    if (client.roomId === roomId && client.readyState === WebSocket.OPEN) {
      client.send(
        JSON.stringify({
          type: "gameOver",
          winner,
          wins: activeRoom.wins,
        })
      );
    }
  });
}

function resetGame(roomId) {
  activeRoom.board = Array(9).fill(null);
  activeRoom.currentPlayer = "X";
  console.log("Game reset for room:", activeRoom.board);
  setTimeout(() => broadcastRoomState(roomId), 1000);
}

async function sendPrizeToWinner(symbol) {
  const players = activeRoom.players;
  const winner = Object.values(players).find(p => p.symbol === symbol);
  const loser = Object.values(players).find(p => p.symbol !== symbol);

  if (!winner || !loser) {
    console.log("No winner or loser found, skipping prize transfer");
    return;
  }

  const totalLamports = bets[winner.ws.id] + bets[loser.ws.id];
  let toPubkey;

  try {
    toPubkey = new solanaWeb3.PublicKey(winner.pubkey); // Validate pubkey
  } catch (error) {
    console.error("Invalid winner public key:", winner.pubkey, error.message);
    return;
  }

  // Check escrow balance
  const escrowBalance = await connection.getBalance(escrowKeypair.publicKey);
  if (escrowBalance < totalLamports + 5000) { // Add 5000 lamports for tx fee
    console.error(`Escrow balance too low: ${escrowBalance} lamports, needed: ${totalLamports + 5000}`);
    return;
  }

  const transaction = new solanaWeb3.Transaction().add(
    solanaWeb3.SystemProgram.transfer({
      fromPubkey: escrowKeypair.publicKey,
      toPubkey,
      lamports: totalLamports,
    })
  );

  try {
    const signature = await solanaWeb3.sendAndConfirmTransaction(connection, transaction, [escrowKeypair]);
    console.log("Sent prize to winner:", signature);
  } catch (error) {
    console.error("Failed to send prize:", error.message);
  }
}

server.listen(3003, () => {
  console.log("Server running on port 3003");
});
