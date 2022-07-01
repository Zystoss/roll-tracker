/** TODO: 
 * SETTINGS - CAN PLAYERS CLEAR THEIR OWN ROLLS? TREAT FORTUNE/MISFORTUNE AS ONLY THE ROLL TAKEN OR BOTH ROLLED?
 * * HAVE CHECKBOXES FOR WHAT KIND OF ROLLS ARE CONSIDERED - VERY SYSTEM SPECIFIC
 * PRINT COMPARISON CARD OF ALL PLAYERS, HIGHLIGHT BEST/WORST
 * SEPARATE BY CHARACTER?
 * SIZE OF DICE TO BE TRACKED
 */

/** QUESTIONS:
 * I DON'T UNDERSTAND HOW ROLLTRACKERHELPER.WAITFOR3DDICEMESSAGE ACTUALLY WORKS - WHAT DOES RESOLVE(TRUE) MEAN? DOESN'T IT BECOME
 * AN ENDLESS LOOP IF THE 'ELSE' OF THE FIRST CONDITIONAL JUST RUNS THE FUNCTION AGAIN?
 */

// Whenever a chat message is created, check if it contains a roll. If so, parse it to determine
// whether it should be tracked, according to our module settings
Hooks.on('createChatMessage', (chatMessage) => {
    if (chatMessage.isRoll) {
        RollTracker.parseMessage(chatMessage, RollTracker.SYSTEM)
    }
})

// This adds our icon to the player list
Hooks.on('renderPlayerList', (playerList, html) => {

    if (game.user.isGM) {
        if (game.settings.get(RollTracker.ID, RollTracker.SETTINGS.GM_SEE_PLAYERS)) {
            // This adds our icon to ALL players on the player list, if the setting is toggled
            // tooltip
                const tooltip = game.i18n.localize('ROLL-TRACKER.button-title')
            // create the button where we want it to be
                for (let user of game.users) {
                    const buttonPlacement = html.find(`[data-user-id="${user.id}"]`)
                    buttonPlacement.append(
                        `<button type="button" title='${tooltip}' class="roll-tracker-item-button flex0" id="${user.id}"><i class="fas fa-dice-d20"></i></button>`
                    )
                    html.on('click', `#${user.id}`, (event) => {
                        new RollTrackerDialog(user.id).render(true);
                    })
                }
            }
        else {
            // Put the roll tracker icon only beside the GM's name
            const loggedInUser = html.find(`[data-user-id="${game.userId}"]`)

            const tooltip = game.i18n.localize('ROLL-TRACKER.button-title')

            loggedInUser.append(
                `<button type="button" title='${tooltip}' class="roll-tracker-item-button flex0" id="${game.userId}"><i class="fas fa-dice-d20"></i></button>`
            )
            html.on('click', `#${game.userId}`, (event) => {
                new RollTrackerDialog(game.userId).render(true);
            })
        }
    }
     else if (game.settings.get(RollTracker.ID, RollTracker.SETTINGS.PLAYERS_SEE_PLAYERS)) {
    // find the element which has our logged in user's id
        const loggedInUser = html.find(`[data-user-id="${game.userId}"]`)

        const tooltip = game.i18n.localize('ROLL-TRACKER.button-title')

        loggedInUser.append(
            `<button type="button" title='${tooltip}' class="roll-tracker-item-button flex0" id="${game.userId}"><i class="fas fa-dice-d20"></i></button>`
        )
        html.on('click', `#${game.userId}`, (event) => {
            new RollTrackerDialog(game.userId).render(true);
        })
    }
})

// Register our module with the Dev Mode module, for logging purposes
Hooks.once('devModeReady', ({ registerPackageDebugFlag }) => {
    registerPackageDebugFlag(RollTracker.ID)
})

// Initialize dialog and settings on foundry boot up
Hooks.once('init', () => {
    RollTracker.initialize()
})

// We're using sockets to ensure the streak message is always transmitted by the GM.
// This allows us to completely hide it from players if a part of the streak was blind, or if
// the Hide All Streak Messages setting is enabled
Hooks.once('ready', () => {
    socket.on("module.roll-tracker", (data) => {
        if (game.user.isGM) {
            if (data.whisper === true) data.whisper = [game.userId]
            ChatMessage.create(data)
        }
    }) 
})

// Just a helper handlebars function so for our "Mode" line in the FormApp, if there is exactly 1
// instance of a mode, the text will read "instance" as opposed to "instances"
Handlebars.registerHelper('isOne', function (value) {
    return value === 1;
});

// Just a helper handlebars function so for our "Mode" line in the FormApp, if there is more than 1 
// mode, the text will read ".... instances *each*" as opposed to "... instances" 
Handlebars.registerHelper('isMultimodal', function (value) {
    return value.length > 1;
});

// Store basic module info
class RollTracker { 
    static ID = 'roll-tracker'

    static FLAGS = {
        SORTED: 'sorted',
        EXPORT: 'export',
        UNSORTED: 'unsorted',
        STREAK: 'streak'
    }

    static TEMPLATES = {
        ROLLTRACK: `modules/${this.ID}/templates/${this.ID}.hbs`,
        CHATMSG: `modules/${this.ID}/templates/${this.ID}-chat.hbs`
    }

    // This logging function ties in with the Developer Mode module. It will log a custom, module namespaced
    // message in the dev console when RollTracker.log() is called. When Developer Mode is not enabled (as in
    // most non-dev environments) the log will not show. Prevents logs leaking into full releases
    static log(force, ...args) {
        const shouldLog = force || game.modules.get('_dev-mode')?.api?.getPackageDebugValue(this.ID)

        if (shouldLog) {
            console.log(this.ID, '|', ...args)
        }
    }

    static SETTINGS = {
        GM_SEE_PLAYERS: 'gm_see_players',
        PLAYERS_SEE_PLAYERS: 'players_see_players',
        ROLL_STORAGE: 'roll_storage',
        COUNT_HIDDEN: 'count_hidden',
        STREAK_MESSAGE_HIDDEN: 'streak_message_hidden',
        DND5E: {
            RESTRICT_COUNTED_ROLLS: 'restrict_counted_rolls'
        },
        PF2E: {
            RESTRICT_COUNTED_ROLLS: 'restrict_counted_rolls'
        }
    }

    static initialize() {
        // Store the current system, for settings purposes. It has to be set here, and not in the parent
        // class, because the system needs to initialize on foundry boot up before we can get its id
        this.SYSTEM = `${game.system.id}`

        // A setting to toggle whether the GM can see the icon allowing them access to player roll
        // data or not
        game.settings.register(this.ID, this.SETTINGS.GM_SEE_PLAYERS, {
            name: `ROLL-TRACKER.settings.${this.SETTINGS.GM_SEE_PLAYERS}.Name`,
            default: true,
            type: Boolean,
            scope: 'world',
            config: true,
            hint: `ROLL-TRACKER.settings.${this.SETTINGS.GM_SEE_PLAYERS}.Hint`,
            onChange: () => ui.players.render()
        })

        // A setting to determine how many rolls should be stored at any one time
        game.settings.register(this.ID, this.SETTINGS.ROLL_STORAGE, {
            name: `ROLL-TRACKER.settings.${this.SETTINGS.ROLL_STORAGE}.Name`,
            default: 50,
            type: Number,
            range: {
                min: 10,
                max: 500,
                step: 10
            },
            scope: 'world',
            config: true,
            hint: `ROLL-TRACKER.settings.${this.SETTINGS.ROLL_STORAGE}.Hint`,
        })

        // A setting to determine whether players can see their own tracked rolls
        game.settings.register(this.ID, this.SETTINGS.PLAYERS_SEE_PLAYERS, {
            name: `ROLL-TRACKER.settings.${this.SETTINGS.PLAYERS_SEE_PLAYERS}.Name`,
            default: true,
            type: Boolean,
            scope: 'world',
            config: true,
            hint: `ROLL-TRACKER.settings.${this.SETTINGS.PLAYERS_SEE_PLAYERS}.Hint`,
            onChange: () => ui.players.render()
        })

        // A setting to determine whether blind GM rolls that PLAYERS make are tracked
        // Blind GM rolls that GMs make are always tracked
        game.settings.register(this.ID, this.SETTINGS.COUNT_HIDDEN, {
            name: `ROLL-TRACKER.settings.${this.SETTINGS.COUNT_HIDDEN}.Name`,
            default: true,
            type: Boolean,
            scope: 'world',
            config: true,
            hint: `ROLL-TRACKER.settings.${this.SETTINGS.COUNT_HIDDEN}.Hint`,
        })

        game.settings.register(this.ID, this.SETTINGS.STREAK_MESSAGE_HIDDEN, {
            name: `ROLL-TRACKER.settings.${this.SETTINGS.STREAK_MESSAGE_HIDDEN}.Name`,
            default: true,
            type: Boolean,
            scope: 'world',
            config: true,
            hint: `ROLL-TRACKER.settings.${this.SETTINGS.STREAK_MESSAGE_HIDDEN}.Hint`,
        })

        // System specific settings
        switch(this.SYSTEM) {
            case 'dnd5e':
                // A setting to specify that only rolls connected to an actor will be counted, not just
                // random '/r 1d20s' or the like
                game.settings.register(this.ID, this.SETTINGS.DND5E.RESTRICT_COUNTED_ROLLS, {
                    name: `ROLL-TRACKER.settings.dnd5e.${this.SETTINGS.DND5E.RESTRICT_COUNTED_ROLLS}.Name`,
                    default: true,
                    type: Boolean,
                    scope: 'world',
                    config: true,
                    hint: `ROLL-TRACKER.settings.dnd5e.${this.SETTINGS.DND5E.RESTRICT_COUNTED_ROLLS}.Hint`,
                })
                break;
            case 'pf2e':
                // A setting to specify that only rolls connected to an actor will be counted, not just
                // random '/r 1d20s' or the like
                game.settings.register(this.ID, this.SETTINGS.PF2E.RESTRICT_COUNTED_ROLLS, {
                    name: `ROLL-TRACKER.settings.pf2e.${this.SETTINGS.PF2E.RESTRICT_COUNTED_ROLLS}.Name`,
                    default: true,
                    type: Boolean,
                    scope: 'world',
                    config: true,
                    hint: `ROLL-TRACKER.settings.pf2e.${this.SETTINGS.PF2E.RESTRICT_COUNTED_ROLLS}.Hint`,
                })
                break;
        }   
    }

    // This function creates an object containing all the requirements that need to be met for the roll
    // to be counted, taking into account all the currently active settings. If all of the conditions are
    // met, the roll is recorded.
    static async parseMessage(chatMessage, system) {
        const isBlind = chatMessage.data.blind
        const rollRequirements = {
            isd100: chatMessage._roll.dice?.[0].faces === 100,
            blindCheck: (!isBlind) || (isBlind && game.settings.get(this.ID, this.SETTINGS.COUNT_HIDDEN)) || (isBlind && game.users.get(chatMessage.user.id)?.isGM),
        }
        switch (system) {
            case 'dnd5e':
                if (game.settings.get(this.ID, this.SETTINGS.DND5E.RESTRICT_COUNTED_ROLLS)) {
                    if (chatMessage.data.flags.dnd5e?.roll?.type) {
                        rollRequirements.dnd5e_restrict_passed = true
                    } else {
                        rollRequirements.dnd5e_restrict_passed = false
                    }
                }
                break;
            case 'pf2e':
                if (game.settings.get(this.ID, this.SETTINGS.PF2E.RESTRICT_COUNTED_ROLLS)) {
                    if (chatMessage.data.flags.pf2e?.context?.type) {
                        rollRequirements.pf2e_restrict_passed = true
                    } else {
                        rollRequirements.pf2e_restrict_passed = false
                    }
                }
                break;
        }
        const checksPassed = Object.values(rollRequirements).every(check => {
            return check === true
        })            
        if (chatMessage.isContentVisible) await RollTrackerHelper.waitFor3DDiceMessage(chatMessage.id)
        if (checksPassed) {
            RollTrackerData.createTrackedRoll(chatMessage.user, chatMessage.roll, isBlind)
        }
    }
}

class RollTrackerHelper {
// Functions that don't specifically manipulate data but are referenced or used
    // If Dice So Nice is enabled, this will help us wait until after the animation is shown
    // to send chat messages such as the Streak chat message, so we don't ruin the surprise of
    // the roll
    static async waitFor3DDiceMessage(targetMessageId) {
        function buildHook(resolve) {
          Hooks.once('diceSoNiceRollComplete', (messageId) => {
            if (targetMessageId === messageId)
              resolve(true);
            else
              buildHook(resolve)
          });
        }
        return new Promise((resolve, reject) => {
          if(game.dice3d){
            buildHook(resolve);
          } else {
            resolve(true);
          }
        });
      }          
}

class RollTrackerData { 
// Our main data workhorse class
    static getUserRolls(userId) {
    // A simple retrieve method that gets the stored flag on a specified user
         const output = {
            user: game.users.get(userId),    
            sorted: game.users.get(userId)?.getFlag(RollTracker.ID, RollTracker.FLAGS.SORTED),
            unsorted: game.users.get(userId)?.getFlag(RollTracker.ID, RollTracker.FLAGS.UNSORTED),
            export: game.users.get(userId)?.getFlag(RollTracker.ID, RollTracker.FLAGS.EXPORT),
            streak: game.users.get(userId)?.getFlag(RollTracker.ID, RollTracker.FLAGS.STREAK)
        } 
        return output
    }

    static createTrackedRoll(user, rollData, isBlind) {
        if (game.userId === user.id) {
        // this check is necessary because (I think) every instance of foundry currently running tries
        // to create and update these rolls. Players, however, do not have permission to edit the data
        // of other users, so errors are thrown. This way the only foundry instance that creates the tracked
        // roll is the foundry instance of the user actually making the roll
            let updatedRolls = []
            const newNumbers = rollData.dice[0].results.map(result => result.result) // In case there's more than one d20 roll in a single instance as in fortune/misfortune rolls
            let oldSorted = this.getUserRolls(user.id)?.sorted || []
            let oldUnsorted = this.getUserRolls(user.id)?.unsorted || []
            const limit = game.settings.get(RollTracker.ID, RollTracker.SETTINGS.ROLL_STORAGE)
            if (oldUnsorted.length >= limit) {
                const difference = oldUnsorted.length - limit
                for (let i = 0; i <= difference; i++) {
                    const popped = oldUnsorted.shift()
                    const remove = oldSorted.findIndex((element) => {
                        return element === popped
                    })
                    oldSorted.splice(remove, 1)
                }    
            }
            if (oldSorted.length) {
                updatedRolls = [...oldSorted]
                newNumbers.forEach(e => {
                    updatedRolls.unshift(e)
                    oldUnsorted.push(e)
                    updatedRolls = this.sortRolls(updatedRolls)
                })

                // Streak calculations
                let streak = {}

                // If there was an ongoing streak, pull those numbers for comparison
                streak.numbers = RollTrackerData.getUserRolls(user.id)?.streak?.numbers || []

                // If the last roll made was a blind roll, the potential streak currently
                // under examination includes a blind roll
                streak.includesBlind = RollTrackerData.getUserRolls(user.id)?.streak?.includesBlind || isBlind

                const currentRoll = oldUnsorted.at(-1)
                const prevRoll = oldUnsorted.at(-2)
                if (prevRoll-1 <= currentRoll && currentRoll <= prevRoll+1) {
                    if (!streak.numbers.length) streak.numbers.push(prevRoll)
                    streak.numbers.push(currentRoll)
                    if (streak.numbers.length >= 2) {
                        const streakString = streak.numbers.join(', ')
                        let chatOpts = {
                            content: `<strong>${user.name} is on a streak!</strong> </br> ${streakString}`, speaker: {alias: 'Roll Tracker'}
                        }

                        // If the current roll is blind, or the last roll was blind, the streak message should be transmitted
                        // only to the GM (as it may reveal earlier rolls).
                        // Alternatively, if the setting to make streak messages always hidden is enabled, transmit it only
                        // to the GM
                        const streakHidden = game.settings.get(RollTracker.ID, RollTracker.SETTINGS.STREAK_MESSAGE_HIDDEN)
                        if (isBlind || streak.includesBlind || streakHidden) {
                            chatOpts.whisper = true
                        }
                        if (!game.user.isGM) {
                            socket.emit("module.roll-tracker", chatOpts)
                        } else {
                            chatOpts.whisper = [game.userId]
                            ChatMessage.create(chatOpts)
                        }

                    }
                    game.users.get(user.id)?.setFlag(RollTracker.ID, RollTracker.FLAGS.STREAK, streak)

                } else {
                    game.users.get(user.id)?.unsetFlag(RollTracker.ID, RollTracker.FLAGS.STREAK)
                }
                
            } else {
                updatedRolls = newNumbers
                oldUnsorted = newNumbers
            }
            return Promise.all([
                game.users.get(user.id)?.setFlag(RollTracker.ID, RollTracker.FLAGS.SORTED, updatedRolls),
                game.users.get(user.id)?.setFlag(RollTracker.ID, RollTracker.FLAGS.UNSORTED, oldUnsorted)
            ])
        }
    }

    static clearTrackedRolls(userId) { 
    // Delete all stored rolls for a specified user ID
        return Promise.all([
            game.users.get(userId)?.unsetFlag(RollTracker.ID, RollTracker.FLAGS.SORTED), 
            game.users.get(userId)?.unsetFlag(RollTracker.ID, RollTracker.FLAGS.EXPORT),
            game.users.get(userId)?.unsetFlag(RollTracker.ID, RollTracker.FLAGS.UNSORTED),
            game.users.get(userId)?.unsetFlag(RollTracker.ID, RollTracker.FLAGS.STREAK)
        ])
    }

    static sortRolls(rolls) {
    // Used to sort the rolls in ascending order for the purposes of median calculation
        return rolls.sort((a, b) => a - b)
    }

    static async prepTrackedRolls(userId) { 
    // Package data for access via the FormApplication

        const username = this.getUserRolls(userId).user.name
        const thisUserId = this.getUserRolls(userId).user.id
        const printRolls = this.getUserRolls(userId).sorted

        let stats = {}

        if (!printRolls) {
            stats.mean = 0
            stats.median = 0
            stats.mode = [0],
            stats.comparator = 0,
            stats.nat1s = 0,
            stats.nat20s = 0
        } else {
            stats = await this.calculate(printRolls)
            // For debugging purposes primarily:
            // stats.lastRoll = this.getUserRolls(userId)?.unsorted.at(-1)
        }

        // DISABLED CODING TO COLLECT AND DISPLAY AVERAGES ACROSS PLAYERS
        // const genComp = await this.generalComparison()
        // let averages = {}
        // for (let stat in genComp) {
        //     averages[stat] = genComp[stat].average
        // }
        
        return { username, thisUserId, stats 
            /**, averages */ }
    }

    static async calculate(rolls) {
    // Turn the raw data array into usable stats:
    // Mean
        const sum = rolls.reduce((firstValue, secondValue) => {
            return firstValue + secondValue
        })
        const mean = Math.round(sum / rolls.length)

    // Median
        // We've already sorted the rolls as they've come in
        let median = 0

        // If there are an odd number of rolls, the median is the centermost number
        if (rolls.length % 2 === 1) {
            let medianPosition = Math.floor(rolls.length / 2)
            median = rolls[medianPosition]
        // If there are an even number of rolls, the median is the average of the two
        // centermost numbers
        } else {
            let beforeMedian = (rolls.length / 2)
            let afterMedian = beforeMedian + 1
            // Subtracting one from each as we transition from length -> index
            // There's a shorter way of doing this but this makes the most sense to me for later
            median = (rolls[beforeMedian-1] + rolls[afterMedian-1]) / 2
        }
         

    // Mode
        const res = await this.calcMode(rolls)
        const modeObj = res.modeObj
        const mode = res.mode
        const comparator = res.comparator

    // We prepare the export data file at this point because the data is conveniently
    // ordered in modeObj
        this.prepareExportData(modeObj)

    // How many Nat1s or Nat20s do we have?
        const nat1s = modeObj[1] || 0
        const nat20s = modeObj[20] || 0        

        return {
            mean,
            median,
            mode,
            comparator,
            nat1s,
            nat20s,
        }
    }

    static async calcMode(rolls) {
        // Mode
        let modeObj = {}
        rolls.forEach(e => {
            if (!modeObj[e]) {
                modeObj[e] = 1
            } else {
                modeObj[e]++
            }
        })

    // the 'comparator' is the integer showing how many times the mode appears
        let comparator = 0

        let mode = []
        for (let rollNumber in modeObj) {
            if (modeObj[rollNumber] > comparator) {
                comparator = modeObj[rollNumber]
                mode.splice(0)
                mode.push(rollNumber)
            } else if (modeObj[rollNumber] === comparator) {
                mode.push(rollNumber)
            }
        }

        return { modeObj, mode, comparator }
    }

    static prepareExportData(data) {
    // prepare the roll data for export to an R-friendly text file
        const keys = Object.keys(data)
        let fileContent = ``
        for (let key of keys) {
            fileContent += `${key},${data[key]}\n`
        }
        // We store the filecontent on a flag on the user so it can be quickly accessed if the user
        // decides to click the export button on the RollTrackerDialog header
        game.users.get(game.userId)?.setFlag(RollTracker.ID, RollTracker.FLAGS.EXPORT, fileContent)
    }

    /**
     *  FUNCTIONAL BUT NOT YET IMPLEMENTED IN UI
     * This function is meant to generate an overall picture across all players of rankings in the
     * various stats. Fully functional, but not accessible in the UI yet. Code exists to make the 
     * averages display alongside the individual player numbers in the tracking card but I didn't like that
    

    static async generalComparison() {
        let allStats = {}
        for (let user of game.users) {
            if (game.users.get(user.id)?.getFlag(RollTracker.ID, RollTracker.FLAGS.SORTED)) {
                const rolls = this.getUserRolls(user.id)?.sorted
                allStats[`${user.id}`] = await this.calculate(rolls)
            }
        }
        // highest/lowest of

            const modes = await this.statsCompare(allStats, 'comparator')
            const means = await this.statsCompare(allStats, 'mean')
            const medians = await this.statsCompare(allStats, 'median')
            const nat1s = await this.statsCompare(allStats, 'nat1s')
            const nat20s = await this.statsCompare(allStats, 'nat20s')

            let finalComparison = {}
            this.prepStats(finalComparison, 'mean', means, allStats)
            this.prepStats(finalComparison, 'median', medians, allStats)
            this.prepStats(finalComparison, 'nat1s', nat1s, allStats)
            this.prepStats(finalComparison, 'nat20s', nat20s, allStats)
            this.prepStats(finalComparison, 'mode', modes, allStats)

            // Mode specific calculations. 
            // When displaying "highest" mode and "lowest" mode, if that player has multiple modes, pick the highest
            // or lowest respectively.
            for (let user in finalComparison.mode.highest) {
                finalComparison.mode.highest[user] = { value: finalComparison.mode.highest[user].at(-1), comparator: allStats[user].comparator }
            }
            for (let user in finalComparison.mode.lowest) {
                finalComparison.mode.lowest[user] = { value: finalComparison.mode.lowest[user].at(0), comparator: allStats[user].comparator }
            }

            // The average mode across players should be the mode of modes
            let newModeObj = {}
            for (let user in allStats) {
                for (let i = 1; i <= allStats[user].comparator; i++) {
                    allStats[user].mode.forEach(e => {
                        if (newModeObj[e]) newModeObj[e]++
                        else (newModeObj[e] = 1)
                    })
                }
            }

            RollTracker.log(false, 'newmodeobj', newModeObj)

            let avmodeComparator = 0
            for (let number in newModeObj) {
                if (newModeObj[number] > avmodeComparator) {
                    avmodeComparator = newModeObj[number]
                    finalComparison.mode.average = [number]
                } else if (newModeObj[number] === avmodeComparator) {
                    finalComparison.mode.average.push(newModeObj[number])
                }
            }

            return finalComparison
    } 


    // A general function to compare incoming 'stats' using a specific data object in the format
    // generated in the allStats variable of generalComparison()
    // Don't use this for MODE - it will not work, as modes are stored as arrays and compared
    // differently. To find the highest/lowest mode among players, run this func with 'comparator'
    static async statsCompare(obj, stat) {
        let topStat = -1;
        let comparison = {}
            for (let user in obj) {
                if (obj[`${user}`][stat] > topStat) {
                    topStat = obj[`${user}`][stat]
                    comparison.top = [user]
                } else if (obj[`${user}`][stat] === topStat) {
                    comparison.top.push(user)
                }
            }

        let botStat = 9999;
            for (let user in obj) {
                if (obj[`${user}`][stat] < botStat) {
                    botStat = obj[`${user}`][stat]
                    comparison.bot = [user]
                } else if (obj[`${user}`][stat] === botStat) {
                    comparison.bot.push(user)
                }
            }

        let statSum = 0
            for (let user in obj) {
                statSum += obj[`${user}`][stat]
            }

        comparison.average = Math.round(statSum / (Object.keys(obj).length))
        
        return comparison
    }

    // A function preparing the output object of generalComparison (the obj is called finalComparison)
    // using previously calculated stats

    static async prepStats(finalComparison, statName, statObj, allStats) {
        finalComparison[statName] = {}
            finalComparison[statName].highest = {}
            finalComparison[statName].lowest = {}
            for (let user of statObj.top) {
                finalComparison[statName].highest[`${user}`] = allStats[`${user}`][statName]
            }
            for (let user of statObj.bot) {
                finalComparison[statName].lowest[`${user}`] = allStats[`${user}`][statName]
            }
            if (statName !== 'mode') finalComparison[statName].average = statObj.average
    }

    * **
    */
}

class RollTrackerDialog extends FormApplication {
    constructor(userId, options={}) {  
    // the first argument is the object, the second are the options
        super(userId, options)
    }

    static get defaultOptions() {
        const defaults = super.defaultOptions
        const overrides = {
            height: 'auto',
            id: 'roll-tracker',
            template: RollTracker.TEMPLATES.ROLLTRACK,
            title: 'Roll Tracker',
        }
        const mergedOptions = foundry.utils.mergeObject(defaults, overrides);
        return mergedOptions
    }

    async getData() {
        const rollData = await RollTrackerData.prepTrackedRolls(this.object)

        // The lines below convert the mode array returned from prepTrackedRolls into a prettier 
        // string for display purposes. We choose to do the conversion to string here so that the
        // prepTrackedRolls func can continue to generate raw data which can be more easily 
        // read/compared/manipulated, as in generalComparison()
        const modeString = rollData.stats.mode.join(', ')
        // const modeString_averages = rollData.averages.mode.join(', ')
        rollData.stats.mode = modeString
        // rollData.averages.mode = modeString_averages

        return rollData
    }

    activateListeners(html) {
        super.activateListeners(html);

        // With the below function, we are specifying that for the _handleButtonClick function, 
        // the keyword 'this' will refer to the current value of this as used in the bind function
        // i.e. RollTrackerDialog
        html.on('click', "[data-action]", this._handleButtonClick.bind(this))
    }

    async _handleButtonClick(event) {
        const clickedElement = $(event.currentTarget)
        const action = clickedElement.data().action
        const userId = clickedElement.parents(`[data-userId]`)?.data().userid
        switch (action) {
            case 'clear': {
                const confirmed = await Dialog.confirm({
                    title: game.i18n.localize("ROLL-TRACKER.confirms.clear_rolls.title"),
                    content: game.i18n.localize("ROLL-TRACKER.confirms.clear_rolls.content"),
                })
                if (confirmed) {
                    await RollTrackerData.clearTrackedRolls(userId)
                    this.render();
                }
                break
            } case 'print': {
                const rollData = await RollTrackerData.prepTrackedRolls(this.object)
                const modeString = rollData.stats.mode.join(', ')
                rollData.stats.mode = modeString

                const content = await renderTemplate(RollTracker.TEMPLATES.CHATMSG, rollData)
                ChatMessage.create( { content } )
            }
        }
    }

    get exportData() {
        return RollTrackerData.getUserRolls(game.userId)?.export
    }

    // This function gets the header data from FormApplication but modifies it to add our export button
    _getHeaderButtons() {
        let buttons = super._getHeaderButtons();
        buttons.splice(0, 0, {
            class: "roll-tracker-form-export",
            icon: "fas fa-download",
            onclick: ev => {
                if (this.exportData) {
                    saveDataToFile(this.exportData, 'string', 'roll-data.txt')
                } else {
                    return ui.notifications.warn("No roll data to export")
                }
            }
        })
        return buttons
    }

}