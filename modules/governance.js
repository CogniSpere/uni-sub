// governance-axis-full.js
// Production-Grade Governance Axis: Proposals, voting, delegation
// System evolution and collective decision-making with quorum enforcement

export const version = "1.0.0";

export const metadata = {
  id: "governance-axis",
  name: "Governance Axis",
  description: "Enterprise-grade proposals, voting, delegation, and quorum enforcement.",
  trust_level: "core"
};

const DEFAULT_SCHEMA = {
  voting: {
    defaultVotingPeriodMs: 7 * 24 * 60 * 60 * 1000, // 7 days
    quorumPercentage: 50, // minimum participation to be valid
    thresholdPercentage: 66, // minimum affirmative votes to pass
    allowChangingVotes: true,
    allowAbstention: true
  },
  delegation: {
    maxChainDepth: 10,
    delegationTtlMs: 30 * 24 * 60 * 60 * 1000, // 30 days
    requireReactivation: true
  },
  proposals: {
    maxConcurrent: 1000,
    requireDescription: true,
    autoClosePastDeadline: true
  }
};

const state = {
  proposals: new Map(), // proposalId -> { id, title, description, status, votes, votingPeriod, ...}
  delegations: new Map(), // delegatorId -> { delegatee, expiresAt, createdAt }
  delegationChains: new Map(), // computed cache for chain resolution
  metrics: {
    proposalsCreated: 0,
    proposalsPassed: 0,
    proposalsRejected: 0,
    totalVotes: 0,
    delegationsActive: 0,
    delegationChainsCycleDetected: 0
  },
  proposalHistory: [], // audit trail
  schema: {}
};

function generateProposalId() {
  return `prop_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

function _ensureProposal(proposalId) {
  if (!state.proposals.has(proposalId)) {
    state.proposals.set(proposalId, {
      id: proposalId,
      title: "",
      description: "",
      status: "active",
      votes: new Map(),
      createdAt: Date.now(),
      createdBy: "system",
      endsAt: Date.now() + state.schema.voting.defaultVotingPeriodMs,
      metadata: {}
    });
  }
  return state.proposals.get(proposalId);
}

function _resolveDelegationChain(voterId, visited = new Set(), depth = 0) {
  // Resolve delegation chain, detect cycles
  if (depth > state.schema.delegation.maxChainDepth) {
    return { resolved: voterId, cycleDetected: true, depth };
  }

  if (visited.has(voterId)) {
    state.metrics.delegationChainsCycleDetected++;
    return { resolved: voterId, cycleDetected: true, depth };
  }

  visited.add(voterId);
  const delegation = state.delegations.get(voterId);

  if (!delegation) {
    return { resolved: voterId, cycleDetected: false, depth };
  }

  // Check if expired
  if (delegation.expiresAt && Date.now() > delegation.expiresAt) {
    state.delegations.delete(voterId);
    return { resolved: voterId, cycleDetected: false, depth };
  }

  return _resolveDelegationChain(delegation.delegatee, visited, depth + 1);
}

function _tallyProposal(proposal) {
  const votes = { yes: 0, no: 0, abstain: 0 };
  
  for (const vote of proposal.votes.values()) {
    votes[vote]++;
  }

  const total = votes.yes + votes.no + votes.abstain;
  const participation = total > 0 ? (total / proposal.voterPool) * 100 : 0;

  const result = {
    proposalId: proposal.id,
    votes,
    total,
    participation: participation.toFixed(2),
    quorumMet: participation >= state.schema.voting.quorumPercentage,
    affirmativePercentage: total > 0 ? ((votes.yes / total) * 100).toFixed(2) : 0,
    passed: total > 0 && votes.yes > (votes.no + votes.abstain) / 2 // simple majority for now
  };

  // Check threshold
  const affirmativeRate = total > 0 ? (votes.yes / total) * 100 : 0;
  result.thresholdMet = affirmativeRate >= state.schema.voting.thresholdPercentage;
  result.passed = result.quorumMet && result.thresholdMet;

  return result;
}

function _auditLog(action, proposalId, actor, details = {}) {
  state.proposalHistory.push({
    id: `audit_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    action,
    proposalId,
    actor,
    timestamp: Date.now(),
    details
  });

  // Keep audit log bounded
  if (state.proposalHistory.length > 5000) {
    state.proposalHistory.shift();
  }
}

export default {
  version,
  metadata,

  async init({ Registry }) {
    console.log("[Governance Axis] Initializing...");

    state.schema = DEFAULT_SCHEMA;

    const api = {
      // ===== Proposal Management =====

      propose: async (proposalObj) => {
        const { title, description = "", createdBy = "system", votingPeriodMs = null, metadata = {} } = proposalObj;

        if (state.schema.proposals.requireDescription && !description) {
          return { success: false, reason: "Description is required" };
        }

        if (state.proposals.size >= state.schema.proposals.maxConcurrent) {
          return { success: false, reason: "Max concurrent proposals reached" };
        }

        const proposalId = generateProposalId();
        const votingPeriod = votingPeriodMs || state.schema.voting.defaultVotingPeriodMs;
        const now = Date.now();

        state.proposals.set(proposalId, {
          id: proposalId,
          title,
          description,
          status: "active",
          votes: new Map(),
          createdBy,
          createdAt: now,
          endsAt: now + votingPeriod,
          votingPeriodMs: votingPeriod,
          voterPool: 0, // Will be updated when first vote is cast
          metadata,
          history: [{ status: "active", timestamp: now, actor: createdBy }]
        });

        state.metrics.proposalsCreated++;
        _auditLog("proposal_created", proposalId, createdBy, { title, votingPeriodMs });

        return {
          success: true,
          proposalId,
          status: "active",
          endsAt: now + votingPeriod
        };
      },

      // ===== Voting =====

      vote: async (proposalId, voterId, voteChoice) => {
        const proposal = state.proposals.get(proposalId);
        if (!proposal) return { success: false, reason: "Proposal not found" };

        if (proposal.status !== "active") {
          return { success: false, reason: `Proposal is ${proposal.status}` };
        }

        if (Date.now() > proposal.endsAt) {
          proposal.status = "closed";
          if (state.schema.proposals.autoClosePastDeadline) {
            const tally = _tallyProposal(proposal);
            proposal.status = tally.passed ? "passed" : "rejected";
            proposal.tally = tally;
          }
          return { success: false, reason: "Voting period ended" };
        }

        const validChoices = ["yes", "no"];
        if (state.schema.voting.allowAbstention) validChoices.push("abstain");

        if (!validChoices.includes(voteChoice)) {
          return { success: false, reason: `Invalid vote choice: ${voteChoice}` };
        }

        // Resolve delegation chain
        const { resolved: actualVoterId, cycleDetected } = _resolveDelegationChain(voterId);

        if (cycleDetected) {
          return { success: false, reason: "Delegation cycle detected, cannot vote" };
        }

        // Record vote
        const previousVote = proposal.votes.get(actualVoterId);
        proposal.votes.set(actualVoterId, { choice: voteChoice, votedAt: Date.now() });

        // Update voter pool estimate
        proposal.voterPool = Math.max(proposal.voterPool, proposal.votes.size);

        state.metrics.totalVotes++;

        _auditLog("vote_cast", proposalId, voterId, {
          voterId: actualVoterId,
          choice: voteChoice,
          previousVote,
          delegationResolved: voterId !== actualVoterId
        });

        return {
          success: true,
          proposalId,
          voterId: actualVoterId,
          voteChoice,
          recorded: true,
          voteCount: proposal.votes.size,
          changedPreviousVote: !!previousVote && previousVote.choice !== voteChoice
        };
      },

      // ===== Tallying =====

      tally: async (proposalId) => {
        const proposal = state.proposals.get(proposalId);
        if (!proposal) return { success: false, reason: "Proposal not found" };

        const result = _tallyProposal(proposal);

        // Auto-close if deadline passed
        if (Date.now() > proposal.endsAt && proposal.status !== "closed") {
          proposal.status = result.passed ? "passed" : "rejected";
          proposal.tally = result;

          if (result.passed) {
            state.metrics.proposalsPassed++;
          } else {
            state.metrics.proposalsRejected++;
          }

          _auditLog("proposal_closed", proposalId, "system", {
            passed: result.passed,
            tally: result
          });
        }

        return {
          success: true,
          ...result
        };
      },

      getProposal: async (proposalId) => {
        const proposal = state.proposals.get(proposalId);
        if (!proposal) return null;

        const tally = _tallyProposal(proposal);

        return {
          id: proposal.id,
          title: proposal.title,
          description: proposal.description,
          status: proposal.status,
          createdBy: proposal.createdBy,
          createdAt: proposal.createdAt,
          endsAt: proposal.endsAt,
          voteCount: proposal.votes.size,
          metadata: proposal.metadata,
          tally,
          votingPercentComplete: ((Date.now() - proposal.createdAt) / (proposal.endsAt - proposal.createdAt) * 100).toFixed(2)
        };
      },

      // ===== Delegation =====

      delegateVote: async (delegatorId, delegateeId, options = {}) => {
        const { ttlMs = state.schema.delegation.delegationTtlMs } = options;

        if (delegatorId === delegateeId) {
          return { success: false, reason: "Cannot delegate to self" };
        }

        // Check for cycles
        const { cycleDetected } = _resolveDelegationChain(delegateeId);
        if (cycleDetected) {
          return { success: false, reason: "Delegation would create a cycle" };
        }

        const expiresAt = ttlMs ? Date.now() + ttlMs : null;
        state.delegations.set(delegatorId, {
          delegatee: delegateeId,
          expiresAt,
          createdAt: Date.now()
        });

        state.delegationChains.delete(delegatorId); // Invalidate cache
        state.metrics.delegationsActive++;

        _auditLog("delegation_created", delegatorId, delegatorId, {
          delegatee: delegateeId,
          expiresAt
        });

        return {
          success: true,
          delegator: delegatorId,
          delegatee: delegateeId,
          expiresAt
        };
      },

      getDelegation: async (delegatorId) => {
        const delegation = state.delegations.get(delegatorId);
        if (!delegation) return null;

        // Check if expired
        if (delegation.expiresAt && Date.now() > delegation.expiresAt) {
          state.delegations.delete(delegatorId);
          return null;
        }

        return {
          delegator: delegatorId,
          delegatee: delegation.delegatee,
          expiresAt: delegation.expiresAt,
          createdAt: delegation.createdAt
        };
      },

      resolveDelegationChain: async (voterId) => {
        const { resolved, cycleDetected, depth } = _resolveDelegationChain(voterId);
        return {
          voterId,
          resolved,
          cycleDetected,
          chainDepth: depth
        };
      },

      revokeDelegation: async (delegatorId) => {
        const delegation = state.delegations.get(delegatorId);
        if (!delegation) return { success: false, reason: "No delegation found" };

        state.delegations.delete(delegatorId);
        state.delegationChains.delete(delegatorId);
        state.metrics.delegationsActive--;

        _auditLog("delegation_revoked", delegatorId, delegatorId, {});

        return {
          success: true,
          delegator: delegatorId,
          delegationRevoked: true
        };
      },

      // ===== Queries =====

      listProposals: async (filters = {}, limit = 50) => {
        const { status = null, createdBy = null, sort = "recent" } = filters;

        let proposals = Array.from(state.proposals.values());

        if (status) {
          proposals = proposals.filter(p => p.status === status);
        }
        if (createdBy) {
          proposals = proposals.filter(p => p.createdBy === createdBy);
        }

        if (sort === "recent") {
          proposals.sort((a, b) => b.createdAt - a.createdAt);
        } else if (sort === "votes") {
          proposals.sort((a, b) => b.votes.size - a.votes.size);
        }

        return proposals.slice(0, limit).map(p => ({
          id: p.id,
          title: p.title,
          status: p.status,
          createdBy: p.createdBy,
          voteCount: p.votes.size,
          endsAt: p.endsAt
        }));
      },

      getMetrics: async () => {
        return {
          proposalsCreated: state.metrics.proposalsCreated,
          proposalsPassed: state.metrics.proposalsPassed,
          proposalsRejected: state.metrics.proposalsRejected,
          passRate: state.metrics.proposalsCreated > 0
            ? (state.metrics.proposalsPassed / state.metrics.proposalsCreated * 100).toFixed(2)
            : 0,
          totalVotes: state.metrics.totalVotes,
          activeDelegations: state.metrics.delegationsActive,
          cycleDetections: state.metrics.delegationChainsCycleDetected,
          activeProposals: Array.from(state.proposals.values()).filter(p => p.status === "active").length,
          proposalHistory: state.proposalHistory.length
        };
      },

      getAuditLog: async (filters = {}, limit = 100) => {
        let results = state.proposalHistory;

        if (filters.action) {
          results = results.filter(e => e.action === filters.action);
        }
        if (filters.proposalId) {
          results = results.filter(e => e.proposalId === filters.proposalId);
        }
        if (filters.actor) {
          results = results.filter(e => e.actor === filters.actor);
        }

        return results.slice(-limit);
      }
    };

    Registry.register("governance-axis-api", api);
    return true;
  },

  async shutdown() {
    state.proposals.clear();
    state.delegations.clear();
    state.delegationChains.clear();
    state.proposalHistory.length = 0;
  }
};
