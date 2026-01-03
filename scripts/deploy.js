const hre = require("hardhat");

async function main() {
    console.log("Deploying DEX AMM...");
    
    // Get deployer account
    const [deployer] = await hre.ethers.getSigners();
    console.log(`Deploying with account: ${deployer.address}`);
    
    // Deploy Token A
    console.log("\nDeploying Token A...");
    const MockERC20 = await hre.ethers.getContractFactory("MockERC20");
    const tokenA = await MockERC20.deploy("Token A", "TKA");
    await tokenA.deployed();
    console.log(`Token A deployed at: ${tokenA.address}`);
    
    // Deploy Token B
    console.log("Deploying Token B...");
    const tokenB = await MockERC20.deploy("Token B", "TKB");
    await tokenB.deployed();
    console.log(`Token B deployed at: ${tokenB.address}`);
    
    // Deploy DEX
    console.log("\nDeploying DEX...");
    const DEX = await hre.ethers.getContractFactory("DEX");
    const dex = await DEX.deploy(tokenA.address, tokenB.address);
    await dex.deployed();
    console.log(`DEX deployed at: ${dex.address}`);
    
    // Approve DEX to spend tokens
    console.log("\nApproving DEX to spend tokens...");
    const maxAmount = hre.ethers.utils.parseEther("1000000");
    await tokenA.approve(dex.address, maxAmount);
    await tokenB.approve(dex.address, maxAmount);
    console.log("Approval complete");
    
    // Add initial liquidity for testing
    console.log("\nAdding initial liquidity...");
    const amountA = hre.ethers.utils.parseEther("1000");
    const amountB = hre.ethers.utils.parseEther("2000");
    await dex.addLiquidity(amountA, amountB);
    console.log(`Added liquidity: ${amountA} Token A and ${amountB} Token B`);
    
    // Get reserves
    const reserves = await dex.getReserves();
    console.log(`\nCurrent Reserves:`);
    console.log(`Token A: ${hre.ethers.utils.formatEther(reserves[0])}`);
    console.log(`Token B: ${hre.ethers.utils.formatEther(reserves[1])}`);
    
    // Get price
    const price = await dex.getPrice();
    console.log(`\nCurrent Price (Token B / Token A): ${hre.ethers.utils.formatEther(price)}`);
    
    // Summary
    console.log("\n=== Deployment Summary ===");
    console.log(`Token A: ${tokenA.address}`);
    console.log(`Token B: ${tokenB.address}`);
    console.log(`DEX: ${dex.address}`);
    console.log("========================\n");
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
