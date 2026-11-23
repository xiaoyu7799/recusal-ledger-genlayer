from pathlib import Path
from types import SimpleNamespace
import unittest


class Rejection(Exception):
    pass


class Contract:
    pass


def identity(value):
    return value


runtime = SimpleNamespace(
    Contract=Contract,
    public=SimpleNamespace(write=identity, view=identity),
    message=SimpleNamespace(sender_address="chair"),
    vm=SimpleNamespace(UserError=Rejection),
    eq_principle=SimpleNamespace(strict_eq=lambda fn: fn()),
    nondet=SimpleNamespace(),
)
scope = dict(gl=runtime, allow_storage=identity, Address=str, u256=int, TreeMap=dict, __name__=__name__)
path = Path(__file__).resolve().parents[1] / "contracts/recusal_ledger.py"
exec(compile(path.read_text().replace("from genlayer import *\n", ""), str(path), "exec"), scope)


class RecusalWorkflow(unittest.TestCase):
    def setUp(self):
        self.contract = scope["RecusalLedger"]()
        self.contract.rounds = {}
        self.contract.disclosures = {}
        self.contract.ballots = {}
        self.members = ["a", "b", "c", "d", "e"]
        self.as_wallet("chair")
        self.contract.open_round("Paid partner.", self.members, 3)

    def as_wallet(self, wallet):
        runtime.message.sender_address = wallet

    def declare(self):
        for member in self.members:
            self.as_wallet(member)
            self.contract.disclose(1, "Declared affiliation.")
        self.as_wallet("chair")

    def review(self, seats):
        runtime.nondet.exec_prompt = lambda *args, **kwargs: {
            "unclear": False,
            "recusals": [
                {"seat": seat, "proposal_quote": "Paid partner.", "disclosure_quote": "Declared affiliation."}
                for seat in seats
            ],
        }
        return self.contract.reconcile(1)

    def test_recusal_changes_eligible_ballots_and_decision(self):
        self.declare()
        self.assertEqual(self.review([0]), "VOTING")
        self.as_wallet("a")
        with self.assertRaisesRegex(Rejection, "SEAT_INELIGIBLE"):
            self.contract.vote(1, True)
        for member in self.members[1:]:
            self.as_wallet(member)
            self.contract.vote(1, member != "e")
        with self.assertRaisesRegex(Rejection, "ALREADY_VOTED"):
            self.contract.vote(1, True)
        self.assertEqual(self.contract.resolve(1), "APPROVED")

    def test_below_quorum_disallows_votes_and_resolution(self):
        self.declare()
        self.assertEqual(self.review([2, 1, 0]), "AWAITING_REPLACEMENTS")
        self.as_wallet("e")
        with self.assertRaisesRegex(Rejection, "VOTING_CLOSED"):
            self.contract.vote(1, True)
        with self.assertRaisesRegex(Rejection, "RESOLUTION_UNAVAILABLE"):
            self.contract.resolve(1)
        self.assertEqual(self.contract.get_round(1)["yes"], 0)

    def test_incomplete_or_ambiguous_evidence_keeps_round_pending(self):
        with self.assertRaisesRegex(Rejection, "MISSING_DISCLOSURES"):
            self.contract.reconcile(1)
        self.declare()
        runtime.nondet.exec_prompt = lambda *args, **kwargs: {"unclear": True}
        with self.assertRaisesRegex(Rejection, "REVIEW_INCONCLUSIVE"):
            self.contract.reconcile(1)
        self.assertEqual(self.contract.get_round(1)["state"], "DISCLOSURES")


if __name__ == "__main__":
    unittest.main()
