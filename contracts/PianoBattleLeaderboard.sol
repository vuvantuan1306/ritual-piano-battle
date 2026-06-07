// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract PianoBattleLeaderboard {
    uint256 public constant SUBMIT_FEE = 0.0001 ether;
    address public owner;

    struct ScoreEntry {
        address player;
        uint256 score;
        uint256 level;
        uint256 correct;
        uint256 timestamp;
    }

    ScoreEntry[] private leaderboard;

    mapping(address => uint256) public bestScore;
    mapping(address => uint256) public bestLevel;
    mapping(address => uint256) public totalSubmissions;

    event ScoreSubmitted(
        address indexed player,
        uint256 score,
        uint256 level,
        uint256 correct,
        uint256 timestamp
    );

    event FeesWithdrawn(address indexed owner, uint256 amount);

    constructor() {
        owner = msg.sender;
    }

    function submitScore(
        uint256 score,
        uint256 level,
        uint256 correct
    ) external payable {
        require(msg.value >= SUBMIT_FEE, "Submit fee is 0.0001 RITUAL");
        require(score > 0, "Score must be greater than 0");
        require(level > 0, "Level must be greater than 0");
        require(correct <= 10, "Correct count must be from 0 to 10");

        leaderboard.push(
            ScoreEntry({
                player: msg.sender,
                score: score,
                level: level,
                correct: correct,
                timestamp: block.timestamp
            })
        );

        totalSubmissions[msg.sender] += 1;

        if (score > bestScore[msg.sender]) {
            bestScore[msg.sender] = score;
            bestLevel[msg.sender] = level;
        }

        emit ScoreSubmitted(
            msg.sender,
            score,
            level,
            correct,
            block.timestamp
        );
    }

    function getLeaderboardLength() external view returns (uint256) {
        return leaderboard.length;
    }

    function getLeaderboardEntry(
        uint256 index
    )
        external
        view
        returns (
            address player,
            uint256 score,
            uint256 level,
            uint256 correct,
            uint256 timestamp
        )
    {
        require(index < leaderboard.length, "Invalid index");

        ScoreEntry memory entry = leaderboard[index];

        return (
            entry.player,
            entry.score,
            entry.level,
            entry.correct,
            entry.timestamp
        );
    }

    function getRecentScores(
        uint256 limit
    ) external view returns (ScoreEntry[] memory) {
        uint256 length = leaderboard.length;

        if (limit > length) {
            limit = length;
        }

        ScoreEntry[] memory recentScores = new ScoreEntry[](limit);

        for (uint256 i = 0; i < limit; i++) {
            recentScores[i] = leaderboard[length - 1 - i];
        }

        return recentScores;
    }

    function withdrawFees() external {
        require(msg.sender == owner, "Only owner can withdraw");

        uint256 balance = address(this).balance;
        require(balance > 0, "No fees to withdraw");

        payable(owner).transfer(balance);

        emit FeesWithdrawn(owner, balance);
    }
}