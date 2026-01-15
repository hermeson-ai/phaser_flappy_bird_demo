/**
 * BaseGame 抽象父类，用于封装 Phaser 游戏的通用配置和状态。
 * 子类负责实现具体的生命周期和游戏逻辑。
 */
class BaseGame {
    constructor() {
        /**
         *   基础配置，可在子类构造函数中修改或扩展。
         *   注意：scene 字段会在 createPhaserGame 中注入。
         */
        this.configurations = {
            type: Phaser.AUTO,
            width: 288,
            height: 512,
            scale: {
                mode: Phaser.Scale.FIT,
                autoCenter: Phaser.Scale.CENTER_BOTH
            },
            physics: {
                default: 'arcade',
                arcade: {
                    gravity: {
                        y: 300
                    },
                    debug: false
                }
            }
        }

        /** 通用资源描述，子类通常会自定义自己的 assets 结构 */
        this.assets = {}

        /** 当前玩家精灵 */
        this.player = null

        /** Phaser.Game 实例 */
        this.game = null

        /** 游戏是否结束 */
        this.gameOver = false

        /** 游戏是否开始 */
        this.gameStarted = false

        /** 重新开始按钮 */
        this.restartButton = null

        /** 退出按钮（当前项目未使用，预留） */
        this.quitButton = null

        /** 开始提示 / 主菜单提示 */
        this.messageInitial = null

        /** 当前得分 */
        this.score = 0
    }

    /**
     * 抽象方法：加载资源。
     * @param {Phaser.Scene} scene
     */
    preload(scene) {
        throw new Error('BaseGame.preload(scene) 需要在子类中实现')
    }

    /**
     * 抽象方法：创建场景对象。
     * @param {Phaser.Scene} scene
     */
    create(scene) {
        throw new Error('BaseGame.create(scene) 需要在子类中实现')
    }

    /**
     * 抽象方法：逐帧更新。
     * @param {Phaser.Scene} scene
     * @param {number} time
     * @param {number} delta
     */
    update(scene, time, delta) {
        throw new Error('BaseGame.update(scene, time, delta) 需要在子类中实现')
    }

    /**
     * 抽象方法：开始游戏逻辑（例如首次点击开始）。
     * @param {Phaser.Scene} scene
     */
    startGame(scene) {
        throw new Error('BaseGame.startGame(scene) 需要在子类中实现')
    }

    /**
     * 抽象方法：准备游戏，重置变量并创建主角等。
     * @param {Phaser.Scene} scene
     */
    prepareGame(scene) {
        throw new Error('BaseGame.prepareGame(scene) 需要在子类中实现')
    }

    /**
     * 抽象方法：重新开始游戏。
     */
    restartGame() {
        throw new Error('BaseGame.restartGame() 需要在子类中实现')
    }

    /**
     * 抽象方法：更新计分板。
     */
    updateScoreboard() {
        throw new Error('BaseGame.updateScoreboard() 需要在子类中实现')
    }

    quitGame(){
        throw new Error('BaseGame.quitGame() 需要在子类中实现')
    }
}

/**
 * 工具方法：根据子类创建 Phaser.Game，并把 scene 生命周期委托给子类实例。
 * @param {typeof BaseGame} GameClass - 继承自 BaseGame 的子类构造函数
 * @param {object} [configOverrides] - 可选的配置覆盖项（如宽高、重力等）
 * @return {BaseGame} - 已绑定 Phaser.Game 的游戏实例
 */
function createPhaserGame(GameClass, configOverrides = {}) {
    const instance = new GameClass()

    const sceneConfig = {
        preload: function () {
            console.log("preload!");
            instance.preload(this)
        },
        create: function () {
            console.log("create!");
            instance.create(this)
        },
        update: function (time, delta) {
            instance.update(this, time, delta)
        }
    }

    // 合并配置（浅合并，scale / physics 如需更细粒度可在子类中完全自定义）
    const finalConfig = Object.assign({}, instance.configurations, configOverrides, {
        scene: sceneConfig
    })

    instance.game = new Phaser.Game(finalConfig)
    return instance
}
