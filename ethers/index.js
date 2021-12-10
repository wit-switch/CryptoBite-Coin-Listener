import { ethers } from 'ethers'
import fs from 'fs'
import dotenv from 'dotenv'
dotenv.config({ path: `.env.${process.env.NODE_ENV}` })

const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_HTTP_HOST)
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider)
const FactoryABI = readJson(process.env.PANCAKE_FACTORY_ABI_PATH)
const RouterABI = readJson(process.env.PANCAKE_ROUTER_ABI_PATH)
const PairABI = readJson(process.env.PAIR_ABI_PATH)
const BUSDABI = readJson(process.env.BUSD_ABI_PATH)
const PancakeFactory = new ethers.Contract(process.env.PANCAKE_FACTORY, FactoryABI, provider)
const PancakeRouter = new ethers.Contract(process.env.PANCAKE_ROUTER, RouterABI, wallet)
const BUSD = new ethers.Contract(process.env.BUSD_ADDRESS, BUSDABI, wallet);

async function main() {
    const pairContract = await PancakeFactory.getPair(process.env.WBNB_ADDRESS, process.env.TARGET_ADDRESS)
    console.log('pairContract', pairContract)
    if (pairContract === ethers.constants.AddressZero) {
        console.log('contractListener')
        contractListener()
    } else {
        console.log('swapCoin')
        swapCoin()
    }
}

function contractListener() {
    PancakeFactory.on("PairCreated", async (token0, token1, pair) => {
        if (token0.toLowerCase() === process.env.TARGET_ADDRESS.toLowerCase() || token1.toLowerCase() === process.env.TARGET_ADDRESS.toLowerCase()) {
            const PairContract = new ethers.Contract(pair, PairABI, provider)
            const reserves = await PairContract.getReserves()
            if (reserves[0] > 0) {
                console.log("token0", token0)
                console.log("token1", token1)
                console.log("addressPair", pair)
                console.log("\n")

                PancakeFactory.off("PairCreated")
                swapCoin()
            }
        }
    })
}

async function swapCoin() {
    const slippage = 0.5; // slippage percentage

    const BUSDAmountToPay = ethers.utils.parseUnits('1000'); // 1000 BUSD
    if (BUSDAmountToPay > 0) {
        const estimateCoinReceive = await PancakeRouter.getAmountsOut(BUSDAmountToPay, [BUSD.address, process.env.WBNB_ADDRESS, process.env.TARGET_ADDRESS]); // estimate Coin recieve from spending 5 BUSD
        const minCoinReceive = parseInt(estimateCoinReceive[2] - estimateCoinReceive[2] * slippage / 100); // set minimum Coin receive

        // give an allowance to the Router when needed
        const BUSDAllowance = await BUSD.allowance(wallet.address, PancakeRouter.address); // get allowance amount
        if (BUSDAllowance < BUSDAmountToPay) {
            await BUSD.approve(PancakeRouter.address, BUSDAmountToPay.toString(), gas); // grant Router ability to transfer BUSD out of our wallet
        }

        console.log('Swapping',
            ethers.utils.formatUnits(BUSDAmountToPay.toString()), 'BUSD for ',
            ethers.utils.formatUnits(minCoinReceive.toString()), 'Coin'
        );

        // set gas for swap
        const gasPrice = await provider.getGasPrice()
        const gasLimit = await PancakeRouter.estimateGas.swapExactTokensForTokens(
            BUSDAmountToPay.toString(),
            minCoinReceive.toString(),
            [BUSD.address, process.env.WBNB_ADDRESS, process.env.TARGET_ADDRESS],
            wallet.address,
            Math.floor(new Date().getTime() / 1000) + 60 * 10, // 10 minutes from now
        )

        // swapping heppened here
        const buyTrx = await PancakeRouter.swapExactTokensForTokens(
            BUSDAmountToPay.toString(),
            minCoinReceive.toString(),
            [BUSD.address, process.env.WBNB_ADDRESS, process.env.TARGET_ADDRESS],
            wallet.address,
            Math.floor(new Date().getTime() / 1000) + 60 * 10, // 10 minutes from now
            {
                gasPrice: gasPrice.mul(2), // gasPrice * 2
                gasLimit: ethers.BigNumber.from(gasLimit * 1.5) // gasLimit * 1.5
            }
        );

        console.log('Transaction hash is:', buyTrx.hash);
        await buyTrx.wait(); // wait until transaction confirmed
        console.log('Transaction confirmed.');
    }
}

function readJson(path) {
    return JSON.parse(fs.readFileSync(path, 'utf8'))
}

main()