# Notes for Shamsy

## What was built

The order screen, with every rule enforced in the database rather than the browser:

- fixed dollar prices (the owner can override a price on a line, and the line keeps both prices)
- a discount per line, coloured sand / red / blocked
- owner approval for lines above 5%
- one rate per order, never below the minimum
- saved orders that can never change

It works on a phone, keeps working on a dropped connection, and every rate, threshold and price is a
setting the owner changes, not something written into the code. The worked example gives exactly
the numbers in the brief, and an automated phone test replays it on every change.

## How the 5% block was proved

Four ways, and each is refused:

- through the app's API
- straight to the database API
- lying that the line is "sand" at 1%
- writing the orders table directly

`npm run prove -- <url>` shows all four. A further test inserts a 7.25% line with the **service-role
key**, bypassing the API altogether, and the database still refuses it. So the block holds even
against our own back-office scripts, not only against advisers.

## What I would do differently in the real build

1. **Corrections as new events, never edits.** A saved order can't change, so a mistake needs a
   cancellation or credit line that references the original. That's the same "book per event" rule
   as the ledger. I'd design the order statuses (draft → confirmed → paid → released → cancelled)
   in step 2, not later.
2. **Store rates as scaled integers**, for example SDG per USD × 100. Rates are whole pounds today,
   but exchangers and Airwallex quote decimals, and a column type is painful to change once history
   depends on it.
3. **The outbox in IndexedDB rather than localStorage**, with Background Sync. Receipts come with
   photos of the proof, and those need a proper blob store on the phone.
4. **Approvals pushed, not polled.** The owner is in Europe. A notification (WhatsApp template or
   web push) with one-tap approve matters more than the screen itself. Polling is fine for the trial.
5. **Nx monorepo, generated database types, and pgTAP tests** running against a local Supabase in CI.
   In this trial the rules are tested through the public API against a hosted project, which proves
   the behaviour, but it's slower than it should be for a team.
6. **A `rates` history table** (date, rate, minimum, set_by), not just the current setting, so
   "what was the minimum on 3 August?" has an answer. Today that answer only lives in the audit log.

## What is unclear or may be wrong in the rules

1. **The boundaries overlap.** "Up to 3%" is sand and "3% to 5%" is red. I made exactly 3.00% sand,
   exactly 5.00% red (and savable), and above 5.00% blocked, decided on exact cents. So $103.00 off
   $2,060 is red, and $103.01 off is blocked. Please confirm.
2. **Rounded percentages can mislead.** A 5.004% discount displays as "5.00%" but is blocked.
   Showing three decimals near a boundary, or blocking at the displayed value, would avoid a
   confused adviser. Which do you prefer?
3. **What exactly does the owner approve?** An unsaved order has no id, so I bound each approval to
   dealer, product, quantity, price and discount, usable once. Questions: should an approval expire
   (for example, at the end of the Sudanese business day)? And should the owner be able to answer
   "not 7.25%, but 6% is fine"?
4. **An order saved offline is checked when it reaches the server.** If the owner raised the minimum
   rate in between, the order is refused and stays on the phone marked "refused". The alternative
   is checking against the minimum when the order was made, but a phone's clock can't be trusted
   for that. Your call.
5. **The pound price is fixed when the order is saved, but payment comes in instalments over days**
   while the pound falls. The currency result will show the loss, but the order probably needs a
   validity date after which the pound amount is re-quoted. Otherwise a dealer who pays a week late
   pays last week's rate.
6. **The minimum rate is fixed at 8,000 in the trial**, but the brief says it must be a setting.
   It's built as a setting (Settings → Minimum rate), with 8,000 as the starting value.
7. **SDG amounts are exact to the piastre** (dollar cents × rate). Customers pay in whole pounds and
   in transfers of up to 3,000,000, so step 2 needs a rounding rule for what the customer is actually
   asked to pay.
