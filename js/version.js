/*
Version log writing guide:
- Write from the player's or game's point of view, not from the code's point of view.
- Describe functional behavior and gameplay impact instead of internal helpers, tags, thresholds, or refactors.
- Keep titles short, plain-language, and feature-oriented.
- Keep notes concise and focused on what changed in play, pacing, risk, or clarity.
- Do not mention log, speedmode, or internal diagnostics changes in public version entries.
- Keep internal batch or output-location changes out of the public version log.
- Group related tuning work into one coherent entry instead of listing every small internal step.
- Add optional contributor credits as dedicated metadata instead of release notes.
*/

export const APP_VERSION = "1.24.1";

export const VERSION_LOG = [
	{
		version: "1.24.1",
		date: "2026-09-03",
		title: "The fix reaches previously opened tables",
		notes: [
			"A laptop that had opened the table before could stay on its old offline copy after repeated refreshes, even though the new release was live. The offline worker now identifies its own release and refreshes every core file when it installs, so an old page can discover the update without already having the new page code.",
		],
	},
	{
		version: "1.24.0",
		date: "2026-09-03",
		title: "Every screen stays on the same turn",
		notes: [
			"The shared table no longer sends overlapping copies of the whole game. On a real connection, an older copy could arrive after a newer one and move joined screens backwards — hiding the current buttons or leaving the table waiting on a turn the player could no longer see. Updates now travel in strict order, with the newest waiting state sent as soon as the current one lands.",
		],
	},
	{
		version: "1.23.0",
		date: "2026-09-03",
		title: "Pages open instantly, and blips stay invisible",
		notes: [
			"Every page waited on a lettering file from Google before it drew anything. On a connection that cannot reach it, that was a thirteen second stare at nothing; the page now appears immediately and the lettering arrives when it does. Opening a seat went from 12.7 seconds to a tenth of a second.",
			"A single dropped message no longer looks like a lost connection. Your screen checks in with the table several times a second, and one failed check used to hide your buttons and announce a problem — at an ordinary rate of dropped messages that happened a dozen times a minute. It now takes a real run of failures, and the warning clears itself the moment the table answers again.",
			"On the join screen, a seat someone already has now reads properly instead of running the words together.",
		],
	},
	{
		version: "1.22.0",
		date: "2026-09-03",
		title: "The table catches up the moment you look at it",
		notes: [
			"The shared table now notices when it has been in another tab and picks the game straight back up, instead of waiting out pauses that expired long ago. Browsers slow a tab that is not the visible one down to a crawl, and the shared table is the thing actually running the game.",
			"Keep the shared table on screen while you play. It is the game, not a scoreboard — if it is buried behind another tab, everyone waits.",
		],
	},
	{
		version: "1.21.0",
		date: "2026-09-03",
		title: "Your move waits for the table",
		notes: [
			"A move that does not get through first time is now sent again, several times, before anybody is told anything. A single dropped packet used to be enough to warn you, and dropped packets are ordinary.",
			"Once a move is with the table's server it stays there, offered again every couple of seconds, until the table collects it. Nothing is on a stopwatch any more.",
			"The old \u201Cthat did not reach the table\u201D message is gone. If your move is waiting to be played, it says so. If the table genuinely cannot be reached, it says that instead, so you know whether pressing again is worth doing.",
			"Tested by dropping a quarter and then two fifths of every call on purpose: 43 moves, no false alarms. On the previous version the same test produced 17.",
		],
	},
	{
		version: "1.20.0",
		date: "2026-09-02",
		title: "A move can no longer be lost",
		notes: [
			"Fixed a second way a player's move could be destroyed: pressing twice, or a connection quietly retrying, could send a copy of an earlier move that landed after the action had moved on and wiped out the next player's move.",
			"Moves are now filed under the turn they belong to, so two players' moves cannot touch each other at all.",
		],
	},
	{
		version: "1.19.0",
		date: "2026-09-02",
		title: "Two people can play",
		notes: [
			"Fixed the bug that made a second person's moves vanish. The table checks for a waiting move several times a second, and as the action passed from one player to the next it could pick up the next player's move, throw it away, and report that nothing had arrived — which is why the table froze and why one player kept being told their move had not been picked up.",
			"This only ever happened with two or more people playing on their own devices, which is why one person against bots was flawless.",
			"The community cards no longer flicker. Every card was being thrown away and redrawn several times a second even when nothing had changed; now a card is only redrawn when it actually changes.",
		],
	},
	{
		version: "1.18.0",
		date: "2026-09-01",
		title: "Timing that keeps up with itself",
		notes: [
			"Your own move now shows on your own screen the instant you press the button, instead of waiting for the table to answer. Only the table's reaction takes any time.",
			"The table log can no longer fall behind the play. A bot waits for the table to finish announcing the last move before making its own, and if messages ever do stack up they catch up rather than drifting further behind.",
			"Nothing happens too quickly to watch any more: the fastest possible fold takes about nine tenths of a second rather than four tenths.",
			"The countdown to the next hand now shows the same number on every screen. It used to sit frozen on players' own views while the shared table counted down.",
			"Deal Next Round and Fast Forward pressed on a player's own laptop now reach the table in well under a second.",
		],
	},
	{
		version: "1.17.0",
		date: "2026-09-01",
		title: "Stop losing the game to a refresh",
		notes: [
			"A new version arriving no longer refreshes the shared table in the middle of a game. It waits until the game is over, because a refresh ends the game for everyone who joined.",
			"Closing or refreshing the shared table during a game now asks for confirmation first, rather than binning the game without warning.",
		],
	},
	{
		version: "1.16.0",
		date: "2026-09-01",
		title: "Bots that think like people",
		notes: [
			"Bots no longer take the same pause every time. A fold comes back almost instantly, a call takes a moment, and a raise takes longer while they weigh up the size.",
			"Every pause is drawn at random from a range, so a lap of the table stops sounding like a metronome.",
			"Occasionally a bot properly tanks over a big decision, the way a real player does.",
			"Whoever is to act now has a gently pulsing dot beside their name, on the shared table and on every player's own view. If it is still beating, the table has not frozen.",
			"A player's name stays on their seat while they think, instead of being replaced.",
		],
	},
	{
		version: "1.15.0",
		date: "2026-08-31",
		title: "Snappier turns",
		notes: [
			"Acting is about twice as quick: the table now notices a player's move in a third of a second rather than a whole one.",
			"Bots pause for a beat rather than three seconds each, so a lap of the table no longer takes the best part of a minute. Still slow enough to follow what they did.",
			"The wait between hands is seven seconds rather than twenty, and Deal Next Round still skips it.",
			"The message warning that a move has not reached the table now waits longer before appearing, so a slow connection does not look like a fault.",
		],
		estimated: false,
	},
	{
		version: "1.14.0",
		date: "2026-08-31",
		title: "Fast Forward and Deal Next Round on your own screen",
		notes: [
			"Both buttons now appear on every player's own view, not just the shared table, so nobody has to switch windows to press them.",
			"Fast Forward shows whenever only bots are left to act in the hand. Deal Next Round shows between hands, with the countdown on it.",
			"Either button can be pressed by any player, and the table acts on it within a second or so.",
		],
		estimated: false,
	},
	{
		version: "1.13.0",
		date: "2026-08-31",
		title: "Draw for seats",
		notes: [
			"Seats are now drawn at random when a game starts, the way a real table does it, instead of seating people in the order their names were typed.",
			"Two people at a six-handed table were previously always neighbours for the whole session, because the dealer button moves the running order round without changing who sits beside whom. Position is most of what makes hold'em interesting, so it is worth varying.",
		],
		estimated: false,
	},
	{
		version: "1.12.0",
		date: "2026-08-31",
		title: "The table fits on the screen",
		notes: [
			"The table no longer runs off the top and bottom of a laptop screen. Everything — both rows of seats, the board, the controls — now fits without scrolling.",
			"Card and chip sizes shrink to suit a short screen instead of only a narrow one.",
			"The setup panel puts the player counts and name boxes on one row where there is space.",
		],
		estimated: false,
	},
	{
		version: "1.11.0",
		date: "2026-08-31",
		title: "A minute to get back to your seat",
		notes: [
			"Closing a laptop or letting a phone sleep no longer costs you your seat for a full minute, so there is time to reopen it and carry on where you left off.",
			"While the table waits, it now says how long a device has been out of touch, so the room can tell someone thinking from someone who has dropped out — and take the turn over by hand if they have.",
		],
		estimated: false,
	},
	{
		version: "1.10.1",
		date: "2026-08-31",
		title: "Survive the server restarting",
		notes: [
			'If the table server restarts in the middle of a hand, the game now refills it by itself within a few seconds instead of leaving everyone stuck on "Table unavailable".',
		],
		estimated: false,
	},
	{
		version: "1.10.0",
		date: "2026-08-31",
		title: "Names, and waiting for everyone",
		notes: [
			"Type each person's name straight into the setup panel, instead of having to work out that the labels on the seats were editable.",
			"Starting a game for two or more people now opens the table and waits until everyone has joined on their own device before dealing, showing who is still to arrive. There is a Deal now button if you would rather not wait.",
			"Fixed an action taken on a joined device being lost when the shared table was still running an older cached copy of the game, which left the buttons greyed out for the rest of the hand.",
			"If an action is not acknowledged, the buttons come back so it can be tried again instead of staying dead.",
		],
		estimated: false,
	},
	{
		version: "1.9.0",
		date: "2026-08-31",
		title: "Multiplayer switched on",
		notes: [
			"The table is now connected to its own server, so games for two or more people work: everyone joins on their own laptop or phone and sees only their own cards.",
			"Before starting a game for two or more, the table checks the server is reachable and says plainly what is wrong if it is not.",
		],
		estimated: false,
	},
	{
		version: "1.8.0",
		date: "2026-08-31",
		title: "Join from a laptop with a code",
		notes: [
			"The shared table now shows a join address and a short table code, so players can join by typing rather than needing a phone that reads QR codes.",
			"A new join page takes the code, lists the seats, and lets you pick your own.",
			"You can choose the full table view, which shows the whole game alongside your own cards and suits a laptop, or the compact cards-only view for a phone.",
			'Fixed a player view that could stay stuck on "Loading table" when it was opened in a background tab.',
		],
		estimated: false,
	},
	{
		version: "1.7.0",
		date: "2026-08-31",
		title: "Choose who is playing",
		notes: [
			"A setup panel now lets you pick how many people and how many bots are at the table, instead of leaving it to guess which seats you typed a name into.",
			"It also tells you what your choice means: with one person your cards are face up on the shared screen, and with two or more everyone needs their own phone.",
			"Bots continue to play themselves automatically, as before.",
		],
		estimated: false,
	},
	{
		version: "1.6.0",
		date: "2026-08-30",
		title: "Clearer betting and private turns",
		notes: [
			"The bet amount is now the total you are raising TO, so the slider, the button and the chips that reach the table all show the same number.",
			"You can type the amount you want to raise to instead of dragging the slider to it.",
			"When you have joined on your own device, your action buttons appear there and no longer on the shared screen. The shared table can still take a turn over if a device drops out.",
			"Amounts are shown in pounds.",
			"Fixed pages running off the edge on small phones, and re-enabled pinch to zoom.",
		],
		estimated: false,
	},
	{
		version: "1.5.2",
		date: "2026-08-22",
		title: "Sharper paired-board calls",
		notes: [
			"Bots now judge private pair strength more carefully when a paired board makes a hand look like two pair.",
			"Weak lower pairs and small pocket pairs are easier to release under pressure, while stronger board pairs and overpairs keep their defensive role.",
			"Postflop defense stays active without relying on structurally weak bluffcatchers.",
		],
		estimated: false,
	},
	{
		version: "1.5.1",
		date: "2026-08-22",
		title: "Cleaner multi-raised pots",
		notes: [
			"Bots are now more selective when calling additional preflop raises with fragile hands that play poorly after the flop.",
			"Suited, connected, paired, and otherwise playable hands keep their role while weaker speculative hands reach fewer difficult pots.",
		],
		estimated: false,
	},
	{
		version: "1.5.0",
		date: "2026-07-31",
		title: "Your-turn sound alerts",
		credit: {
			name: "dedodgingese",
			url: "https://github.com/dedodgingese",
		},
		notes: [
			"A short sound now signals when it is time for a human player to act.",
			"Solo games play the alert on the shared table, while multiplayer alerts stay on the active player's companion or remote view.",
			"A saved Sound on/off control lets each device silence alerts.",
		],
		estimated: false,
	},
	{
		version: "1.4.0",
		date: "2026-06-19",
		title: "Continue saved games",
		notes: [
			"Unfinished Solo vs Bots games can now be continued after reopening the table on the same device.",
			"A startup prompt lets you continue the saved game or start fresh.",
		],
		estimated: false,
	},
	{
		version: "1.2.9",
		date: "2026-06-15",
		title: "Smarter preflop realization",
		notes: [
			"Bots now judge fragile short-handed starts more by connectivity, suitedness, domination risk, and position instead of one narrow offsuit rule.",
			"Low connected offsuit hands can still stay active when they play well enough, while disconnected trash stays out.",
			"Small-blind heads-up and three-handed button pots should keep their action, with fewer passive weak limps.",
		],
		estimated: false,
	},
	{
		version: "1.2.8",
		date: "2026-06-15",
		title: "Cleaner short-handed starts",
		notes: [
			"Bots now avoid more weak offsuit junk limps when first in from the small blind heads-up or the button three-handed.",
			"Playable suited hands, connectors, pairs, and stronger broadways keep their normal short-handed role.",
			"Short-handed pots should still stay active, but fewer fragile offsuit starts should reach weak flops.",
		],
		estimated: false,
	},
	{
		version: "1.2.7",
		date: "2026-06-14",
		title: "Sharper first-in preflop ranges",
		notes: [
			"Bots now keep more playable broadway hands and small pairs in suitable first-in spots instead of folding them too often.",
			"Early seats and fuller tables stay more selective, so the added playability should not turn into broad loose opening.",
			"Late and short-handed first-in pots should feel more credible while the overall tournament pace stays close to the previous version.",
		],
		estimated: false,
	},
	{
		version: "1.2.6",
		date: "2026-05-13",
		title: "More active tournament play",
		notes: [
			"Bots now play short-handed tournament spots more actively, especially when stealing blinds or defending against steals.",
			"Button and small-blind situations should create more realistic pressure instead of waiting too often for premium hands.",
			"Marginal blind defenses are still trimmed in the riskiest spots, so the added action stays more disciplined.",
		],
		estimated: false,
	},
	{
		version: "1.2.5",
		date: "2026-05-12",
		title: "Better flop defense",
		notes: [
			"Bots now defend more plausible high-card flops with ace-high, overcards, or useful backdoor potential when the price is close.",
			"Very weak no-pair hands and bad weak draws are still released, so the added defense should not turn into broad loose calling.",
			"Standard flop bluffs should have less automatic success against hands that still belong in a defended range.",
		],
		estimated: false,
	},
	{
		version: "1.2.4",
		date: "2026-05-11",
		title: "Cleaner multiway call defense",
		notes: [
			"Bots now avoid more weak offsuit ace and king calls with the lowest kickers when facing raises in multiway pots.",
			"Heads-up blind defense, suited versions, stronger broadways, pairs, and aggressive preflop lines keep their normal role.",
			"These hands should create fewer weak high-card and fragile pair spots after the flop without making playable hands broadly disappear.",
		],
		estimated: false,
	},
	{
		version: "1.2.3",
		date: "2026-05-11",
		title: "Cleaner heads-up blind limps",
		notes: [
			"Heads-up small-blind bots now avoid open-limping the weakest offsuit ace hands, choosing a raise or fold more often instead.",
			"Suited aces, suited kings, connectors, pairs, and normal raising ranges keep their active role.",
			"Weak ace starts should create fewer high-card and weak-pair rescue spots without making the small blind broadly tighter.",
		],
		estimated: false,
	},
	{
		version: "1.2.2",
		date: "2026-05-11",
		title: "Cleaner small-pair starts",
		notes: [
			"Bots now avoid open-limping the smallest pairs from most first-in seats, choosing a raise or fold instead.",
			"Cheap heads-up small-blind limps stay available, so short-handed blind play keeps its lower-cost option.",
			"Small pair starts should create fewer weak underpair flops without removing normal pair aggression.",
		],
		estimated: false,
	},
	{
		version: "1.2.1",
		date: "2026-05-11",
		title: "Cleaner blind defense",
		notes: [
			"Bots now defend the big blind a little more selectively with weak suited hands after a raise.",
			"Weak suited misses should reach the flop less often, while pairs, broadways, suited connectors, and other playable defenses keep their normal role.",
			"Postflop action and showdown flow stay close to the previous version.",
		],
		estimated: false,
	},
	{
		version: "1.2.0",
		date: "2026-05-10",
		title: "Automatic next round",
		notes: [
			"After a completed hand, the New Round button now shows a short countdown before the next hand starts automatically.",
			"A compact cancel control can stop the automatic start while keeping the normal New Round button available.",
			"Game-over summaries stay manual and do not start another hand.",
		],
		estimated: false,
	},
	{
		version: "1.1.0",
		date: "2026-05-02",
		title: "Stronger game engine foundation",
		notes: [
			"Core poker flow now runs through clearer shared engine paths for actions, betting rounds, streets, hand starts, hand endings, and showdown results.",
			"Bot tournaments can be validated across much larger simulated samples, making bot tuning less noisy and reducing the risk of rule regressions.",
			"All-ins, side pots, heads-up blinds, action order, bustouts, and full-hand runouts now have broader direct coverage.",
			"The visible table experience stays the same while the rules foundation becomes faster to validate and safer to evolve.",
		],
		estimated: false,
	},
	{
		version: "1.0.30",
		date: "2026-04-29",
		title: "Stronger checked postflop ranges",
		notes: [
			"Bots can now keep more real value in their checking range after the flop, so a checked street is less automatically weak.",
			"Some strong value hands now check with the intention of raising if an opponent bets into them.",
			"Broader value checks can still continue through normal call-or-raise decisions, improving defense without making bots broadly more aggressive.",
		],
		estimated: false,
	},
	{
		version: "1.0.29",
		date: "2026-04-26",
		title: "Sharper first-in preflop choices",
		notes: [
			"Bots now choose first-in raises and limps with more attention to position, hand shape, and short-handed table flow.",
			"Weak dominated open-limps are less common, while pairs, suited hands, connectors, and stronger broadways keep their playable role.",
			"Small-blind heads-up and button three-handed spots stay active without turning every first-in hand into raise-or-fold poker.",
		],
		estimated: false,
	},
	{
		version: "1.0.28",
		date: "2026-04-26",
		title: "More context-aware preflop calls",
		notes: [
			"Bots now judge passive preflop calls more by position, price, and blind-defense context.",
			"Weak dominated hands are easier to release, while suited hands, pairs, and connected hands keep their playable role.",
			"Short-handed play keeps its action, but passive calls should now produce cleaner flop ranges.",
		],
		estimated: false,
	},
	{
		version: "1.0.27",
		date: "2026-04-26",
		title: "Cleaner passive preflop calls",
		notes: [
			"Bots now avoid more weak offsuit hands in passive preflop call and limp spots.",
			"Playable suited hands, pairs, and stronger broadways remain active, while dominated junk reaches the flop less often.",
			"Flop defense is now supported by cleaner preflop inputs instead of rescuing too many weak missed hands later.",
		],
		estimated: false,
	},
	{
		version: "1.0.26",
		date: "2026-04-26",
		title: "Cleaner late-street bluffcatching",
		notes: [
			"Bots now release more weak Turn and River bluffcatchers when their hand strength mostly comes from the board.",
			"Thin public-pair and kicker-only continues are less likely to carry defense against pressure.",
			"Private made hands, clear pair value, and real drawing equity before the River keep their existing defensive role.",
		],
		estimated: false,
	},
	{
		version: "1.0.25",
		date: "2026-04-26",
		title: "More credible postflop defense",
		notes: [
			"Bots now defend postflop with more emphasis on credible hand quality instead of filling call frequency with weak bluffcatchers.",
			"Cheap bets are still defended more readily, but weak board-only, kicker-only, and bad-price draw hands are easier to release.",
			"Flop calls stay selective, with extra defense coming from plausible equity rather than broad weak-pair continues.",
		],
		estimated: false,
	},
	{
		version: "1.0.24",
		date: "2026-04-24",
		title: "Cleaner side-pot all-ins",
		notes: [
			"Bots no longer turn all-in side-pot calls into raises when no opponent can call extra chips.",
			"Late-hand all-ins now stay closer to the real available action, reducing misleading reraise pressure.",
			"Strong value can still raise normally when at least one live opponent can call the extra amount.",
		],
		estimated: false,
	},
	{
		version: "1.0.23",
		date: "2026-04-23",
		title: "More selective pair play after the flop",
		notes: [
			"Bots now separate strong pair value more clearly from weaker or board-driven pair spots after the flop.",
			"Checked-to pair bets and reraises became more selective, especially in multiway pots and other thin early-tournament situations.",
			"Weaker pair hands are less likely to bloat pots, while clear value hands still keep their normal pressure.",
			"Short-stack postflop decisions stay aggressive with real value but are less eager to stack off with marginal pair strength.",
			"Internal speedmode reporting was updated so these weaker pair spots stay visible in diagnostics.",
		],
		estimated: false,
	},
	{
		version: "1.0.22",
		date: "2026-04-19",
		title: "Fixed tournament sizing and early deep-stack frequency",
		notes: [
			"Replaced preflop sizing with fixed tournament-style opens, 3-bets, squeezes, and 4-bets.",
			"Made preflop IP/OOP sizing follow the current hand's action order relative to the last aggressor.",
			"Capped postflop sizing to clear 30, 40, 55, and 75 percent pot buckets.",
			"Reduced early deep-stack reraises so level 0-1 pots escalate less often before stacks naturally get shallow.",
			"Kept normal opens, standard checked-to aggression, and Harrington short-stack behavior intact.",
		],
		estimated: false,
	},
	{
		version: "1.0.21",
		date: "2026-04-14",
		title: "Slowplay and bustout-call tightening",
		notes: [
			"Restricted postflop slowplay to clearer trap spots so strong value hands no longer check back rivers, multiway spots, or other thin-delay situations.",
			"Added an edge-scaled postflop elimination-relief path for heads-up tournament-life calls with strong private made hands on unpaired boards.",
			"Kept paired-board all-in folds structurally tighter so dangerous trips and full-house runouts still respect the tougher stackoff context.",
		],
		estimated: false,
	},
	{
		version: "1.0.20",
		date: "2026-04-13",
		title: "MDF defense and alpha bluffing",
		notes: [
			"Added MDF-based postflop defense so bots no longer overfold thin bluff-catch spots.",
			"Extended that MDF defense to marginal and thin turn situations so more weak-but-playable hands stay in the game.",
			"Made pure bluffs follow a clearer alpha-based frequency model so bluffing and defending now work from the same basic risk-reward idea.",
		],
		estimated: false,
	},
	{
		version: "1.0.19",
		date: "2026-04-09",
		title: "Marginal-edge postflop tuning",
		notes: [
			"Added a shared treatment for marginal postflop hands so thin spots behave more consistently.",
			"Made small made hands and weak draws more pot-control oriented under pressure.",
			"Kept thin heads-up river bluff-catching available while trimming fragile hope-calls.",
		],
		estimated: false,
	},
	{
		version: "1.0.18",
		date: "2026-04-07",
		title: "Minimum-aware reraise calls",
		notes: [
			"Stopped some over-forced reraises from being inflated into larger raises than intended.",
			"Kept real short-stack all-ins available while softening awkward non-all-in escalation.",
		],
		estimated: false,
	},
	{
		version: "1.0.17",
		date: "2026-04-06",
		title: "Edge-first postflop sizing and reraise damping",
		notes: [
			"Reworked postflop bet sizing so edge matters more than noisy spot modifiers.",
			"Reduced forced overbetting and calmer multi-raise escalation.",
			"Made aggressive postflop lines feel more controlled and less swingy.",
		],
		estimated: false,
	},
	{
		version: "1.0.16",
		date: "2026-04-05",
		title: "Postflop cost curve and speedmode diagnostics",
		notes: [
			"Made private hand improvements matter more in postflop decisions.",
			"Improved postflop risk handling and checked-to filtering.",
			"Added better internal reporting for blocked follow-up spots.",
		],
		estimated: false,
	},
	{
		version: "1.0.15",
		date: "2026-04-03",
		title: "Spot-first non-value tuning",
		notes: [
			"Made non-value postflop decisions react more to the actual spot structure.",
			"Tightened loose stabs so passive spots need cleaner permission before turning aggressive.",
		],
		estimated: false,
	},
	{
		version: "1.0.14",
		date: "2026-04-03",
		title: "Situational non-value read tuning",
		notes: [
			"Made postflop reads more situational instead of table-average based.",
			"Tightened free bluffing while keeping normal c-bets and barrels available.",
		],
		estimated: false,
	},
	{
		version: "1.0.13",
		date: "2026-04-03",
		title: "Postflop premium rescue guardrail",
		notes: [
			"Added a safety net so very strong postflop hands no longer fold away too often.",
			"Kept the rest of the postflop logic intact around that narrow guardrail.",
		],
		estimated: false,
	},
	{
		version: "1.0.12",
		date: "2026-04-03",
		title: "River low-edge call guardrail",
		notes: [
			"Stopped busted draw pressure from leaking into finished river boards.",
			"Added a river safety check to cut very weak bluff-catch calls.",
		],
		estimated: false,
	},
	{
		version: "1.0.11",
		date: "2026-04-02",
		title: "Score-based private edge signals",
		notes: [
			"Reworked private postflop edge signals to be more score-based and direct.",
			"Added a new `meaningful` lift tier between kicker and structural spots.",
			"Updated logs and summaries so these spot types stay visible.",
		],
		estimated: false,
	},
	{
		version: "1.0.10",
		date: "2026-04-02",
		title: "Private-edge postflop guardrails",
		notes: [
			"Stopped dedicated bluff lines from leaking into private made hands.",
			"Added a small private-edge check for postflop value and protection raises.",
			"Expanded logs and docs so private-edge spots are easier to read.",
		],
		estimated: false,
	},
	{
		version: "1.0.9",
		date: "2026-04-02",
		title: "Premium preflop no-fold guardrail",
		notes: [
			"Added a simple guardrail so premium preflop hands no longer fold away.",
			"Kept the rest of the tournament bot logic unchanged around that safety check.",
			"Aligned the premium threshold across runtime and debug output.",
		],
		estimated: false,
	},
	{
		version: "1.0.8",
		date: "2026-04-02",
		title: "Legacy bot baseline restored",
		notes: [
			"Restored the older heuristic tournament bot as the active default.",
			"Moved the bot back toward more playable tournament-style behavior.",
			"Updated the docs so they match the live runtime again.",
		],
		estimated: false,
	},
	{
		version: "1.0.7",
		date: "2026-04-01",
		title: "Short-handed opens and passive-street probes",
		notes: [
			"Improved short-handed opening ranges, especially in late short-table spots.",
			"Made bots react better after passive heads-up streets.",
			"Added a few more heads-up probe opportunities to reduce full check-through lines.",
		],
		estimated: false,
	},
	{
		version: "1.0.6",
		date: "2026-03-31",
		title: "Spot-based bot baseline stabilization",
		notes: [
			"Finished the move to more explicit preflop spot policies.",
			"Cleaned up short-stack and multi-raised behavior.",
			"Split postflop made-hand defense into clearer strength tiers.",
			"Added a small stab tune for checked-to weak spots.",
		],
		estimated: false,
	},
	{
		version: "1.0.5",
		date: "2026-03-31",
		title: "TAG bot tuning consolidation",
		notes: [
			"Moved the bot toward a clearer TAG-style baseline.",
			"Reworked unopened preflop ranges by seat and table size.",
			"Retuned heads-up and short-handed play to stay active without getting sloppy.",
			"Kept public-board safety while allowing more real c-bets and semibluffs.",
		],
		estimated: false,
	},
	{
		version: "1.0.4",
		date: "2026-03-31",
		title: "Hand-based blind progression",
		notes: [
			"Changed blind progression from orbit-based jumps to a hand-based cadence.",
			"Cleaned up the blind ladder to feel more like a normal tournament structure.",
			"Kept the rest of the table flow unchanged.",
		],
		estimated: false,
	},
	{
		version: "1.0.3",
		date: "2026-03-30",
		title: "Tournament unopened raise-or-fold",
		notes: [
			"Switched unopened green-zone preflop play to raise-or-fold.",
			"Standardized normal tournament open sizes around 2.5bb.",
			"Left push-or-fold and other preflop branches alone.",
		],
		estimated: false,
	},
	{
		version: "1.0.2",
		date: "2026-03-30",
		title: "Public-board postflop fix",
		notes: [
			"Split postflop strength into private aggression and public-board defense.",
			"Stopped weak board-made hands from value-raising too often.",
			"Kept narrow semibluff exceptions for stronger draw spots.",
		],
		estimated: false,
	},
	{
		version: "1.0.1",
		date: "2026-03-30",
		title: "Spot-aware bot reads",
		notes: [
			"Replaced table-average reads with more spot-aware bot reads.",
			"Made limped, raised, multi-raised, and multiway spots matter more directly.",
			"Reduced loose non-value aggression in crowded or strength-shown spots.",
		],
		estimated: false,
	},
	{
		version: "1.0.0",
		date: "2026-03-29",
		title: "Stable first public version",
		notes: [
			"Established the first stable public version of the table.",
			"Unified winner and chip-transfer rendering across views.",
			"Fixed a few remaining side-pot edge cases.",
		],
		estimated: false,
	},
	{
		version: "0.9.0",
		date: "2026-03-25",
		title: "Full remote multiplayer table",
		notes: [
			"Added a dedicated remote table view.",
			"Added remote actions and switching between companion and full-table views.",
			"Synced action labels and winner reactions across remote views.",
		],
		estimated: true,
	},
	{
		version: "0.6.0",
		date: "2026-03-16",
		title: "Session overlays and playback polish",
		notes: [
			"Added stats, log, and instructions overlays.",
			"Added winner reactions.",
			"Added fast forward for bot-only hands.",
		],
		estimated: true,
	},
	{
		version: "0.5.0",
		date: "2026-01-31",
		title: "Tournament-style bot upgrades",
		notes: [
			"Expanded the bots toward more tournament-style play.",
			"Improved postflop handling and spectator presentation.",
			"Kept app updates rolling out more reliably during active iteration.",
		],
		estimated: true,
	},
	{
		version: "0.4.0",
		date: "2025-12-22",
		title: "Synced companion view",
		notes: [
			"Added backend-backed state sync for the companion view.",
			"Added synced polling and notifications in the hole-card view.",
			"Established the optional sync architecture described in the README.",
		],
		estimated: true,
	},
	{
		version: "0.3.0",
		date: "2025-06-15",
		title: "Offline-ready table",
		notes: [
			"Added service-worker caching and offline fallback behavior.",
			"Improved update handling for cached builds.",
			"Reached the first offline-ready table state.",
		],
		estimated: true,
	},
	{
		version: "0.2.0",
		date: "2025-06-09",
		title: "Bots and adaptive table flow",
		notes: [
			"Added bot auto-seating and the first basic bot strategy.",
			"Improved bot actions with better pot-odds and position awareness.",
			"Added early player stats tracking for bot behavior.",
		],
		estimated: true,
	},
	{
		version: "0.1.0",
		date: "2025-06-05",
		title: "Playable local poker table",
		notes: [
			"Added the core local table flow with betting, pot tracking, and notifications.",
			"Added showdown evaluation and side-pot handling.",
			"Reached the first clearly playable local version.",
		],
		estimated: true,
	},
];
