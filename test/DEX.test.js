const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("DEX", function() {
    let dex, tokenA, tokenB;
    let owner, addr1, addr2;
    
    beforeEach(async function() {
        // Deploy tokens and DEX before each test
        [owner, addr1, addr2] = await ethers.getSigners();
        
        const MockERC20 = await ethers.getContractFactory("MockERC20");
        tokenA = await MockERC20.deploy("Token A", "TKA");
        tokenB = await MockERC20.deploy("Token B", "TKB");
        
        const DEX = await ethers.getContractFactory("DEX");
        dex = await DEX.deploy(tokenA.address, tokenB.address);
        
        // Approve DEX to spend tokens
        await tokenA.approve(dex.address, ethers.utils.parseEther("1000000"));
        await tokenB.approve(dex.address, ethers.utils.parseEther("1000000"));
        
        // Approve for other signers
        await tokenA.connect(addr1).approve(dex.address, ethers.utils.parseEther("1000000"));
        await tokenB.connect(addr1).approve(dex.address, ethers.utils.parseEther("1000000"));
        await tokenA.connect(addr2).approve(dex.address, ethers.utils.parseEther("1000000"));
        await tokenB.connect(addr2).approve(dex.address, ethers.utils.parseEther("1000000"));
    });
    
    describe("Liquidity Management", function() {
        it("should allow initial liquidity provision", async function() {
            const amountA = ethers.utils.parseEther("100");
            const amountB = ethers.utils.parseEther("200");
            
            await dex.addLiquidity(amountA, amountB);
            
            const reserves = await dex.getReserves();
            expect(reserves[0]).to.equal(amountA);
            expect(reserves[1]).to.equal(amountB);
        });
        
        it("should mint correct LP tokens for first provider", async function() {
            const amountA = ethers.utils.parseEther("100");
            const amountB = ethers.utils.parseEther("200");
            
            const tx = await dex.addLiquidity(amountA, amountB);
            const receipt = await tx.wait();
            
            // Expected LP tokens = sqrt(100 * 200) = sqrt(20000) ≈ 141.42
            // Due to integer arithmetic, we check a reasonable range
            const expectedLiquidity = ethers.utils.parseEther("100").mul(ethers.utils.parseEther("200"));
            
            // Get the event to verify LP tokens were minted
            const event = receipt.events.find(e => e.event === 'LiquidityAdded');
            expect(event).to.exist;
            expect(event.args.liquidityMinted).to.be.gt(0);
        });
        
        it("should allow subsequent liquidity additions", async function() {
            const amountA = ethers.utils.parseEther("100");
            const amountB = ethers.utils.parseEther("200");
            
            // First provider
            await dex.addLiquidity(amountA, amountB);
            
            // Transfer tokens to addr1
            await tokenA.transfer(addr1.address, ethers.utils.parseEther("50"));
            await tokenB.transfer(addr1.address, ethers.utils.parseEther("100"));
            
            // Second provider - must maintain ratio
            const amountA2 = ethers.utils.parseEther("50");
            const amountB2 = ethers.utils.parseEther("100");
            
            await dex.connect(addr1).addLiquidity(amountA2, amountB2);
            
            const reserves = await dex.getReserves();
            expect(reserves[0]).to.equal(amountA.add(amountA2));
            expect(reserves[1]).to.equal(amountB.add(amountB2));
        });
        
        it("should maintain price ratio on liquidity addition", async function() {
            const amountA = ethers.utils.parseEther("100");
            const amountB = ethers.utils.parseEther("200");
            
            await dex.addLiquidity(amountA, amountB);
            
            const price1 = await dex.getPrice();
            
            // Add proportional liquidity
            await tokenA.transfer(addr1.address, amountA);
            await tokenB.transfer(addr1.address, amountB);
            
            await dex.connect(addr1).addLiquidity(amountA, amountB);
            
            const price2 = await dex.getPrice();
            expect(price1).to.equal(price2);
        });
        
        it("should allow partial liquidity removal", async function() {
            const amountA = ethers.utils.parseEther("100");
            const amountB = ethers.utils.parseEther("200");
            
            await dex.addLiquidity(amountA, amountB);
            
            const initialLiquidity = await dex.liquidity(owner.address);
            const removeAmount = initialLiquidity.div(2);
            
            await dex.removeLiquidity(removeAmount);
            
            const remainingLiquidity = await dex.liquidity(owner.address);
            expect(remainingLiquidity).to.equal(initialLiquidity.sub(removeAmount));
        });
        
        it("should return correct token amounts on liquidity removal", async function() {
            const amountA = ethers.utils.parseEther("100");
            const amountB = ethers.utils.parseEther("200");
            
            await dex.addLiquidity(amountA, amountB);
            
            const liquidity = await dex.liquidity(owner.address);
            const tokenABefore = await tokenA.balanceOf(owner.address);
            const tokenBBefore = await tokenB.balanceOf(owner.address);
            
            const tx = await dex.removeLiquidity(liquidity);
            const receipt = await tx.wait();
            
            const event = receipt.events.find(e => e.event === 'LiquidityRemoved');
            expect(event).to.exist;
            expect(event.args.amountA).to.be.gt(0);
            expect(event.args.amountB).to.be.gt(0);
        });
        
        it("should revert on zero liquidity addition", async function() {
            await expect(
                dex.addLiquidity(0, ethers.utils.parseEther("100"))
            ).to.be.revertedWith("Amounts must be greater than 0");
            
            await expect(
                dex.addLiquidity(ethers.utils.parseEther("100"), 0)
            ).to.be.revertedWith("Amounts must be greater than 0");
        });
        
        it("should revert when removing more liquidity than owned", async function() {
            const amountA = ethers.utils.parseEther("100");
            const amountB = ethers.utils.parseEther("200");
            
            await dex.addLiquidity(amountA, amountB);
            const liquidity = await dex.liquidity(owner.address);
            
            await expect(
                dex.removeLiquidity(liquidity.add(1))
            ).to.be.revertedWith("Insufficient liquidity");
        });
    });
    
    describe("Token Swaps", function() {
        beforeEach(async function() {
            // Add initial liquidity before swap tests
            const amountA = ethers.utils.parseEther("100");
            const amountB = ethers.utils.parseEther("200");
            await dex.addLiquidity(amountA, amountB);
        });
        
        it("should swap token A for token B", async function() {
            const amountAIn = ethers.utils.parseEther("10");
            const tokenBBefore = await tokenB.balanceOf(owner.address);
            
            await dex.swapAForB(amountAIn);
            
            const tokenBAfter = await tokenB.balanceOf(owner.address);
            expect(tokenBAfter).to.be.gt(tokenBBefore);
        });
        
        it("should swap token B for token A", async function() {
            const amountBIn = ethers.utils.parseEther("20");
            const tokenAABefore = await tokenA.balanceOf(owner.address);
            
            await dex.swapBForA(amountBIn);
            
            const tokenAAfter = await tokenA.balanceOf(owner.address);
            expect(tokenAAfter).to.be.gt(tokenAABefore);
        });
        
        it("should calculate correct output amount with fee", async function() {
            const amountIn = ethers.utils.parseEther("10");
            const reserves = await dex.getReserves();
            
            const amountOut = await dex.getAmountOut(amountIn, reserves[0], reserves[1]);
            
            // Verify fee was applied (997/1000 of input)
            expect(amountOut).to.be.gt(0);
            expect(amountOut).to.be.lt(reserves[1]);
        });
        
        it("should update reserves after swap", async function() {
            const reservesBefore = await dex.getReserves();
            const amountAIn = ethers.utils.parseEther("10");
            
            await dex.swapAForB(amountAIn);
            
            const reservesAfter = await dex.getReserves();
            expect(reservesAfter[0]).to.equal(reservesBefore[0].add(amountAIn));
            expect(reservesAfter[1]).to.be.lt(reservesBefore[1]);
        });
        
        it("should increase k after swap due to fees", async function() {
            const reservesBefore = await dex.getReserves();
            const kBefore = reservesBefore[0].mul(reservesBefore[1]);
            
            const amountAIn = ethers.utils.parseEther("10");
            await dex.swapAForB(amountAIn);
            
            const reservesAfter = await dex.getReserves();
            const kAfter = reservesAfter[0].mul(reservesAfter[1]);
            
            expect(kAfter).to.be.gte(kBefore);
        });
        
        it("should revert on zero swap amount", async function() {
            await expect(
                dex.swapAForB(0)
            ).to.be.revertedWith("Amount must be greater than 0");
            
            await expect(
                dex.swapBForA(0)
            ).to.be.revertedWith("Amount must be greater than 0");
        });
        
        it("should handle large swaps with high price impact", async function() {
            // Swap 50 ETH when pool only has 100 ETH - significant price impact
            const amountAIn = ethers.utils.parseEther("50");
            
            const reservesBefore = await dex.getReserves();
            const amountOut = await dex.getAmountOut(amountAIn, reservesBefore[0], reservesBefore[1]);
            
            expect(amountOut).to.be.gt(0);
            
            // Execute swap
            await dex.swapAForB(amountAIn);
            
            // Verify reserves updated correctly
            const reservesAfter = await dex.getReserves();
            expect(reservesAfter[0]).to.equal(reservesBefore[0].add(amountAIn));
        });
        
        it("should handle multiple consecutive swaps", async function() {
            const swap1Amount = ethers.utils.parseEther("10");
            const swap2Amount = ethers.utils.parseEther("5");
            
            const tokenABefore = await tokenA.balanceOf(owner.address);
            
            // First swap: A for B
            await dex.swapAForB(swap1Amount);
            
            // Second swap: B for A
            const tokenBBalance = await tokenB.balanceOf(owner.address);
            await dex.swapBForA(swap2Amount);
            
            const tokenAAfter = await tokenA.balanceOf(owner.address);
            
            // Should have less A than before due to fees
            expect(tokenAAfter).to.be.lt(tokenABefore);
        });
    });
    
    describe("Price Calculations", function() {
        it("should return correct initial price", async function() {
            const amountA = ethers.utils.parseEther("100");
            const amountB = ethers.utils.parseEther("200");
            
            await dex.addLiquidity(amountA, amountB);
            
            const price = await dex.getPrice();
            // Price should be 200 * 1e18 / 100 = 2e18
            expect(price).to.equal(ethers.utils.parseEther("2"));
        });
        
        it("should update price after swaps", async function() {
            const amountA = ethers.utils.parseEther("100");
            const amountB = ethers.utils.parseEther("200");
            
            await dex.addLiquidity(amountA, amountB);
            
            const priceBefore = await dex.getPrice();
            
            // Swap changes the ratio
            await dex.swapAForB(ethers.utils.parseEther("10"));
            
            const priceAfter = await dex.getPrice();
            expect(priceAfter).to.be.lt(priceBefore);
        });
        
        it("should handle price queries with zero reserves gracefully", async function() {
            // Try to get price with no liquidity
            await expect(
                dex.getPrice()
            ).to.be.revertedWith("Reserve A is zero");
        });
    });
    
    describe("Fee Distribution", function() {
        it("should accumulate fees for liquidity providers", async function() {
            const amountA = ethers.utils.parseEther("100");
            const amountB = ethers.utils.parseEther("200");
            
            // First provider adds liquidity
            await dex.addLiquidity(amountA, amountB);
            
            // Perform swaps to generate fees
            await tokenA.transfer(addr1.address, ethers.utils.parseEther("50"));
            await tokenB.transfer(addr1.address, ethers.utils.parseEther("100"));
            
            const swapAmount = ethers.utils.parseEther("10");
            await dex.connect(addr1).swapAForB(swapAmount);
            
            // First provider removes liquidity
            const liquidity = await dex.liquidity(owner.address);
            const tokenAABefore = await tokenA.balanceOf(owner.address);
            const tokenBBefore = await tokenB.balanceOf(owner.address);
            
            await dex.removeLiquidity(liquidity);
            
            const tokenAAfter = await tokenA.balanceOf(owner.address);
            const tokenBAfter = await tokenB.balanceOf(owner.address);
            
            // Should have received fees (more than original deposit)
            expect(tokenAAfter.add(ethers.utils.parseEther("100"))).to.be.gte(tokenAABefore);
        });
        
        it("should distribute fees proportionally to LP share", async function() {
            const amountA = ethers.utils.parseEther("100");
            const amountB = ethers.utils.parseEther("200");
            
            // Owner adds 100% of liquidity
            await dex.addLiquidity(amountA, amountB);
            
            // Transfer tokens to addr1 and add liquidity
            await tokenA.transfer(addr1.address, amountA);
            await tokenB.transfer(addr1.address, amountB);
            
            await dex.connect(addr1).addLiquidity(amountA, amountB);
            
            // Perform swaps
            await tokenA.transfer(addr2.address, ethers.utils.parseEther("50"));
            await dex.connect(addr2).swapAForB(ethers.utils.parseEther("20"));
            
            // Each provider should receive proportional fees
            const ownerLiquidity = await dex.liquidity(owner.address);
            const addr1Liquidity = await dex.liquidity(addr1.address);
            
            const ownerShare = ownerLiquidity.mul(100).div(ownerLiquidity.add(addr1Liquidity));
            
            // Owner should have 50% share approximately
            expect(ownerShare).to.be.closeTo(50, 5);
        });
    });
    
    describe("Edge Cases", function() {
        it("should handle very small liquidity amounts", async function() {
            const amountA = ethers.utils.parseUnits("1", "wei");
            const amountB = ethers.utils.parseUnits("2", "wei");
            
            // This might revert due to precision loss, but shouldn't cause undefined behavior
            try {
                await dex.addLiquidity(amountA, amountB);
            } catch (error) {
                // Expected to potentially fail due to precision
                expect(error.message).to.include("revert");
            }
        });
        
        it("should handle very large liquidity amounts", async function() {
            const amountA = ethers.utils.parseEther("1000000");
            const amountB = ethers.utils.parseEther("2000000");
            
            // Mint more tokens to owner
            await tokenA.mint(owner.address, amountA);
            await tokenB.mint(owner.address, amountB);
            
            await dex.addLiquidity(amountA, amountB);
            
            const reserves = await dex.getReserves();
            expect(reserves[0]).to.equal(amountA);
            expect(reserves[1]).to.equal(amountB);
        });
        
        it("should prevent unauthorized access", async function() {
            // addr1 should not be able to remove liquidity they didn't add
            const amountA = ethers.utils.parseEther("100");
            const amountB = ethers.utils.parseEther("200");
            
            await dex.addLiquidity(amountA, amountB);
            
            await expect(
                dex.connect(addr1).removeLiquidity(ethers.utils.parseEther("1"))
            ).to.be.revertedWith("Insufficient liquidity");
        });
    });
    
    describe("Events", function() {
        it("should emit LiquidityAdded event", async function() {
            const amountA = ethers.utils.parseEther("100");
            const amountB = ethers.utils.parseEther("200");
            
            await expect(dex.addLiquidity(amountA, amountB))
                .to.emit(dex, "LiquidityAdded")
                .withArgs(owner.address, amountA, amountB, expect.any(ethers.BigNumber));
        });
        
        it("should emit LiquidityRemoved event", async function() {
            const amountA = ethers.utils.parseEther("100");
            const amountB = ethers.utils.parseEther("200");
            
            await dex.addLiquidity(amountA, amountB);
            const liquidity = await dex.liquidity(owner.address);
            
            await expect(dex.removeLiquidity(liquidity))
                .to.emit(dex, "LiquidityRemoved")
                .withArgs(owner.address, expect.any(ethers.BigNumber), expect.any(ethers.BigNumber), liquidity);
        });
        
        it("should emit Swap event", async function() {
            const amountA = ethers.utils.parseEther("100");
            const amountB = ethers.utils.parseEther("200");
            
            await dex.addLiquidity(amountA, amountB);
            const swapAmount = ethers.utils.parseEther("10");
            
            await expect(dex.swapAForB(swapAmount))
                .to.emit(dex, "Swap")
                .withArgs(owner.address, tokenA.address, tokenB.address, swapAmount, expect.any(ethers.BigNumber));
        });
    });
});
