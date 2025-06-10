import dotenv from 'dotenv';
dotenv.config();

import bs58 from 'bs58';


import express from 'express';
const app = express();


console.log("Escrow Private Key:", process.env.ESCROW_PRIVATE_KEY);
if (!process.env.ESCROW_PRIVATE_KEY) {
  throw new Error("ESCROW_PRIVATE_KEY not found in .env");
}




// Example: Convert string to base58
const input = "Hello, Solana!";
const buffer = Buffer.from(input); // Convert string to Buffer
const base58Encoded = bs58.encode(buffer);
const escrowSecretKey = bs58.decode(process.env.ESCROW_PRIVATE_KEY);
console.log("Escrow Secret Key:", escrowSecretKey);

console.log("Original:", input);
console.log("Base58 Encoded:", base58Encoded);





app.listen(3000, () => {
  console.log('Server is running on port 3000');
}   );


