// governance-axis.js
// Governance Axis: Proposals, voting, delegation
// Defines evolution of the system itself

export const version = "0.1.0";

export const metadata = {
  id: "governance-axis",
  name: "Governance Axis",
  description: "Proposals, voting, delegation and the system evolution layer."
};

const state = {
  proposals: new Map(), // proposalId -> { id, title, description, status, votes: Map, createdBy, createdAt, endsAt }
  delegations: new Map() // delegatorId -> delegateeId
};

function generateProposalId() {
  return `prop_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
}

export default {
  version,
  metadata,

  async init({ Registry }) {
    console.log("[Governance Axis] Initializing...");

    const api = {
      // Create proposal
      propose: async (proposal) => {
        // proposal: { title, description, createdBy, votingPeriodMs }
        const proposalId = generateProposalId();
        const votingPeriodMs = proposal.votingPeriodMs || 7 * 24 * 60 * 60 * 1000; // 7 days default

        const p = {
          id: proposalId,
          title: proposal.title,
          description: proposal.description || "",
          status: "active", // active | closed | passed | rejected
          votes: new Map(), // voterId -> 'yes' | 'no' | 'abstain'
          createdBy: proposal.createdBy,
          createdAt: Date.now(),
          endsAt: Date.now() + votingPeriodMs,
          metadata: proposal.metadata || {}
        };

        state.proposals.set(proposalId, p);
        return { proposalId, status: "active" };
      },

      // Cast vote
      vote: async (proposalId, voterId, voteChoice) => {
        // voteChoice: 'yes' | 'no' | 'abstain'
        const p = state.proposals.get(proposalId);
        if (!p) throw new Error(`Proposal ${proposalId} not found`);

        if (p.status !== "active") throw new Error(`Proposal is ${p.status}, cannot vote`);
        if (Date.now() > p.endsAt) {
          p.status = "closed";
          throw new Error("Voting period ended");
        }

        // Check for delegation: if voterId has delegated, use delegatee's vote
        const actualVoterId = state.delegations.get(voterId) || voterId;

        p.votes.set(actualVoterId, voteChoice);
        return { proposalId, voterId: actualVoterId, voteChoice, recorded: true };
      },

      // Tally votes
      tally: async (proposalId) => {
        const p = state.proposals.get(proposalId);
        if (!p) throw new Error(`Proposal ${proposalId} not found`);

        const votes = { yes: 0, no: 0, abstain: 0 };
        for (const vote of p.votes.values()) {
          votes[vote]++;
        }

        const total = votes.yes + votes.no + votes.abstain;
        const result = {
          proposalId,
          votes,
          total,
          passed: votes.yes > votes.no,
          percentage: total > 0 ? { yes: (votes.yes / total * 100).toFixed(2) } : {}
        };

        // Auto-close if voting period ended
        if (Date.now() > p.endsAt) {
          p.status = result.passed ? "passed" : "rejected";
        }

        return result;
      },

      getProposal: async (proposalId) => {
        const p = state.proposals.get(proposalId);
        if (!p) return null;
        return {
          id: p.id,
          title: p.title,
          description: p.description,
          status: p.status,
          createdBy: p.createdBy,
          createdAt: p.createdAt,
          endsAt: p.endsAt,
          voteCount: p.votes.size,
          metadata: p.metadata
        };
      },

      // Delegation
      delegateVote: async (delegatorId, delegateeId) => {
        state.delegations.set(delegatorId, delegateeId);
        return { delegator: delegatorId, delegatee: delegateeId };
      },

      getDelegation: async (delegatorId) => {
        return state.delegations.get(delegatorId) || null;
      },

      revokeDelegation: async (delegatorId) => {
        state.delegations.delete(delegatorId);
        return { delegator: delegatorId, delegationRevoked: true };
      },

      // List active proposals
      listProposals: async (status = "active") => {
        const proposals = [];
        for (const p of state.proposals.values()) {
          if (!status || p.status === status) {
            proposals.push({
              id: p.id,
              title: p.title,
              status: p.status,
              createdBy: p.createdBy,
              voteCount: p.votes.size
            });
          }
        }
        return proposals;
      }
    };

    Registry.register("governance-axis-api", api);
    return true;
  },

  async shutdown() {
    state.proposals.clear();
    state.delegations.clear();
  }
};
