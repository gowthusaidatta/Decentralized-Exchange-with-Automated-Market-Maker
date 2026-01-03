// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

contract DEX is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // State variables
    address public tokenA;
    address public tokenB;
    uint256 public reserveA;
    uint256 public reserveB;
    uint256 public totalLiquidity;
    mapping(address => uint256) public liquidity;
    
    // Events
    event LiquidityAdded(address indexed provider, uint256 amountA, uint256 amountB, uint256 liquidityMinted);
    event LiquidityRemoved(address indexed provider, uint256 amountA, uint256 amountB, uint256 liquidityBurned);
    event Swap(address indexed trader, address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut);
    
    // Constants
    uint256 private constant FEE = 3; // 0.3% fee (997/1000)
    uint256 private constant PRECISION = 1000;
    
    /// @notice Initialize the DEX with two token addresses
    /// @param _tokenA Address of first token
    /// @param _tokenB Address of second token
    constructor(address _tokenA, address _tokenB) {
        require(_tokenA != address(0) && _tokenB != address(0), "Invalid token addresses");
        require(_tokenA != _tokenB, "Tokens must be different");
        tokenA = _tokenA;
        tokenB = _tokenB;
    }
    
    /// @notice Add liquidity to the pool
    /// @param amountA Amount of token A to add
    /// @param amountB Amount of token B to add
    /// @return liquidityMinted Amount of LP tokens minted
    function addLiquidity(uint256 amountA, uint256 amountB) 
        external 
        nonReentrant
        returns (uint256 liquidityMinted) {
        require(amountA > 0 && amountB > 0, "Amounts must be greater than 0");
        
        // Transfer tokens from user to contract
        IERC20(tokenA).safeTransferFrom(msg.sender, address(this), amountA);
        IERC20(tokenB).safeTransferFrom(msg.sender, address(this), amountB);
        
        if (totalLiquidity == 0) {
            // First liquidity provision
            liquidityMinted = sqrt(amountA * amountB);
        } else {
            // Subsequent liquidity provision
            uint256 liquidityFromA = (amountA * totalLiquidity) / reserveA;
            uint256 liquidityFromB = (amountB * totalLiquidity) / reserveB;
            liquidityMinted = liquidityFromA < liquidityFromB ? liquidityFromA : liquidityFromB;
        }
        
        require(liquidityMinted > 0, "Insufficient liquidity minted");
        
        // Update reserves and liquidity
        reserveA += amountA;
        reserveB += amountB;
        totalLiquidity += liquidityMinted;
        liquidity[msg.sender] += liquidityMinted;
        
        emit LiquidityAdded(msg.sender, amountA, amountB, liquidityMinted);
    }
    
    /// @notice Remove liquidity from the pool
    /// @param liquidityAmount Amount of LP tokens to burn
    /// @return amountA Amount of token A returned
    /// @return amountB Amount of token B returned
    function removeLiquidity(uint256 liquidityAmount) 
        external 
        nonReentrant
        returns (uint256 amountA, uint256 amountB) {
        require(liquidityAmount > 0, "Liquidity amount must be greater than 0");
        require(liquidity[msg.sender] >= liquidityAmount, "Insufficient liquidity");
        
        // Calculate amounts proportional to the user's share
        amountA = (liquidityAmount * reserveA) / totalLiquidity;
        amountB = (liquidityAmount * reserveB) / totalLiquidity;
        
        require(amountA > 0 && amountB > 0, "Amounts must be greater than 0");
        
        // Update state
        liquidity[msg.sender] -= liquidityAmount;
        totalLiquidity -= liquidityAmount;
        reserveA -= amountA;
        reserveB -= amountB;
        
        // Transfer tokens back to user
        IERC20(tokenA).safeTransfer(msg.sender, amountA);
        IERC20(tokenB).safeTransfer(msg.sender, amountB);
        
        emit LiquidityRemoved(msg.sender, amountA, amountB, liquidityAmount);
    }
    
    /// @notice Swap token A for token B
    /// @param amountAIn Amount of token A to swap
    /// @return amountBOut Amount of token B received
    function swapAForB(uint256 amountAIn) 
        external 
        nonReentrant
        returns (uint256 amountBOut) {
        require(amountAIn > 0, "Amount must be greater than 0");
        require(reserveA > 0 && reserveB > 0, "Insufficient reserves");
        
        // Calculate output amount with fee
        amountBOut = getAmountOut(amountAIn, reserveA, reserveB);
        require(amountBOut > 0, "Insufficient output amount");
        require(amountBOut < reserveB, "Insufficient output reserve");
        
        // Transfer input token from user to contract
        IERC20(tokenA).safeTransferFrom(msg.sender, address(this), amountAIn);
        
        // Update reserves
        reserveA += amountAIn;
        reserveB -= amountBOut;
        
        // Transfer output token to user
        IERC20(tokenB).safeTransfer(msg.sender, amountBOut);
        
        emit Swap(msg.sender, tokenA, tokenB, amountAIn, amountBOut);
    }
    
    /// @notice Swap token B for token A
    /// @param amountBIn Amount of token B to swap
    /// @return amountAOut Amount of token A received
    function swapBForA(uint256 amountBIn) 
        external 
        nonReentrant
        returns (uint256 amountAOut) {
        require(amountBIn > 0, "Amount must be greater than 0");
        require(reserveA > 0 && reserveB > 0, "Insufficient reserves");
        
        // Calculate output amount with fee
        amountAOut = getAmountOut(amountBIn, reserveB, reserveA);
        require(amountAOut > 0, "Insufficient output amount");
        require(amountAOut < reserveA, "Insufficient output reserve");
        
        // Transfer input token from user to contract
        IERC20(tokenB).safeTransferFrom(msg.sender, address(this), amountBIn);
        
        // Update reserves
        reserveB += amountBIn;
        reserveA -= amountAOut;
        
        // Transfer output token to user
        IERC20(tokenA).safeTransfer(msg.sender, amountAOut);
        
        emit Swap(msg.sender, tokenB, tokenA, amountBIn, amountAOut);
    }
    
    /// @notice Get current price of token A in terms of token B
    /// @return price Current price (reserveB / reserveA)
    function getPrice() external view returns (uint256 price) {
        require(reserveA > 0, "Reserve A is zero");
        price = (reserveB * 1e18) / reserveA;
    }
    
    /// @notice Get current reserves
    /// @return _reserveA Current reserve of token A
    /// @return _reserveB Current reserve of token B
    function getReserves() external view returns (uint256 _reserveA, uint256 _reserveB) {
        return (reserveA, reserveB);
    }
    
    /// @notice Calculate amount of token B received for given amount of token A
    /// @param amountIn Amount of token input
    /// @param reserveIn Reserve of input token
    /// @param reserveOut Reserve of output token
    /// @return amountOut Amount of token output (after 0.3% fee)
    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut) 
        public 
        pure 
        returns (uint256 amountOut) {
        require(amountIn > 0, "Amount in must be greater than 0");
        require(reserveIn > 0 && reserveOut > 0, "Invalid reserves");
        
        // Apply 0.3% fee: amountInWithFee = amountIn * 997 / 1000
        uint256 amountInWithFee = amountIn * (PRECISION - FEE);
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = (reserveIn * PRECISION) + amountInWithFee;
        
        amountOut = numerator / denominator;
    }
    
    /// @notice Calculate square root using Babylonian method
    /// @param y Number to find square root of
    /// @return z Square root of y
    function sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }
}
