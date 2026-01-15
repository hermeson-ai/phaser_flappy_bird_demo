/**
 * Man Down 100
 * 基于 Phaser 的"是男人就下 100 层"玩法，继承自 BaseGame。
 * - 目标：不断向下跳跃，避免被平台顶出屏幕顶部
 * - 掉出屏幕底部或被顶出屏幕顶部则失败
 */

const BASE_GAME_WIDTH = 320
const BASE_GAME_HEIGHT = 512
const RESOLUTION_SCALE = 3        // 修改该值即可整体放大/缩小游戏画面

const MAN_TOTAL_LEVELS = 100
const MAN_LEVEL_GAP_BASE = 100    // 每一层之间的基础垂直间距
const MAN_MAX_LIVES = 5

const INITIAL_PLATFORM_ROWS = 7
const INITIAL_PLATFORM_START_Y = 80
const PLAYER_START_Y = 60
const PLATFORM_SCROLL_SPEED_BASE = -60

const BASE_PLAYER_DISPLAY_SIZE = { width: 39, height: 68 }
const BASE_PLAYER_BODY_SIZE = { width: 32, height: 60, bottomPadding: 4 }
const HUD_LEVEL_POS = { x: 10, y: 10, infoY: 34 }
const PLAYER_TOP_DEATH_OFFSET = -5
const PLAYER_BOTTOM_DEATH_OFFSET = 5
const PLATFORM_DESPAWN_OFFSET = 50

// 平台类型
const PLATFORM_TYPE = {
    NORMAL: 'normal',      // 普通平台
    FRAGILE: 'fragile',     // 易碎平台（站上后0.5秒消失）
    BOUNCE: 'bounce',    //弹跳平台（站上后角色会弹起)
    POISON: 'poison'    //毒性平台（站上以后角色损失一个生命值）
}

/**
 * Game assets.
 */
const manDownAssets = {
    background: {
        road:'man-background-road',
        stone:'man-background-stone',
        default:'man-background-wall'
    },
    platform: 'man-platform',
    topBarrier: 'man-top-barrier',
    player: {
        walk:'man-player-walk',
        jump:'man-player-jump'
    },
    goal: 'man-goal',
    ui: {
        gameOver: 'man-game-over',
        restart: 'man-restart',
        quit: 'man-quit'
    }
}

/**
 * ManDownGame 具体游戏类，实现 BaseGame 抽象接口。
 */
class ManDownGame extends BaseGame {
    constructor() {
        super()

        this.resolutionScale = RESOLUTION_SCALE
        this.scaleValue = (value) => Math.round(value * this.resolutionScale)

        const scaledWidth = this.scaleValue(BASE_GAME_WIDTH)
        const scaledHeight = this.scaleValue(BASE_GAME_HEIGHT)
        
        console.log("[constructor] scaledW = ",scaledWidth);
        console.log("[constructor] scaledH = ",scaledHeight);
        // 覆盖基础配置为 Man Down 的宽高和重力
        this.configurations = Object.assign({}, this.configurations, {
            width: scaledWidth,
            height: scaledHeight,
            backgroundColor: '#000000',
            scale: {
                mode: Phaser.Scale.FIT,
                autoCenter: Phaser.Scale.CENTER_BOTH
            },
            physics: {
                default: 'arcade',
                arcade: {
                    gravity: { y: 600 * this.resolutionScale },
                    debug: false
                }
            }
        })

        this.assets = manDownAssets

        // 专属状态
        this.platforms = null
        this.cursors = null
        this.jumpKey = null
        this.levelText = null
        this.infoText = null

        this.currentLevel = 1
        this.bestLevel = Number(localStorage.getItem('man_down_best_level') || 0)
        this.lives = MAN_MAX_LIVES
        this.startTime = 0
        this.activeTouchDirection = 0
        this.pointerHalfWidth = 0
        
        // 平台滚动相关
        this.platformScrollSpeed = this.scaleValue(PLATFORM_SCROLL_SPEED_BASE) // 平台向上滚动速度（负值表示向上）
        this.backgroundTile = null
        this.lastPlatformY = 0 // 记录最后一行平台的Y位置
        this.platformGap = this.scaleValue(MAN_LEVEL_GAP_BASE) // 平台之间的固定间距
    }

    /**
     * 资源加载
     * @param {Phaser.Scene} scene
     */
    preload(scene) {
        scene.load.image(this.assets.background.stone, 'assets/bg_stone.png')
        scene.load.image(this.assets.background.road, 'assets/bg_road.png')
        scene.load.image(this.assets.background.default, 'assets/sky_cloud.png')
        scene.load.image(this.assets.platform, 'assets/platform.png')
        scene.load.image(this.assets.topBarrier, 'assets/top.png')
        scene.load.spritesheet(this.assets.player.walk, 'assets/avatar_walk_sprite.png', {
            frameWidth: 198,
            frameHeight: 341
        })
        scene.load.spritesheet(this.assets.player.jump, 'assets/avatar_jump3_sprite.png', {
            frameWidth: 198,
            frameHeight: 341
        })
        // UI
        scene.load.image(this.assets.ui.gameOver, 'assets/gameover.png')
        scene.load.image(this.assets.ui.restart, 'assets/restart-button.png')
        scene.load.image(this.assets.ui.quit, 'assets/back-button.png')
        
    }

    /**
     * 创建场景
     * @param {Phaser.Scene} scene
     */
    create(scene) {
        const { width, height } = scene.scale
        let background = this.assets.background.stone

        switch (Phaser.Math.Between(0, 2)) {
            case 0:
                background = this.assets.background.stone
                break
            case 1: 
                background = this.assets.background.road
                break
            case 2:
            default:
                background = this.assets.background.default
        }

        // 背景（用 tileSprite 填满视口）
        this.backgroundTile = scene.add.tileSprite(width / 2, height / 2, width, height, background)
        
        // 顶部锯齿
        const barrierHeight = this.scaleValue(15)
        this.topBarrier = scene.physics.add.staticImage(width / 2, 0, this.assets.topBarrier)
        this.topBarrier.setOrigin(0.5, 0)
        this.topBarrier.setDisplaySize(width, barrierHeight)
        this.topBarrier.refreshBody()
        this.topBarrier.body.setSize(width, barrierHeight, true)
        this.topBarrier.setDepth(5)
        this.topBarrier.setTint(0x777777)

        // 平台组 - 使用静态组，手动更新位置
        this.platforms = scene.physics.add.staticGroup()

        const initialPlatformStartY = this.scaleValue(INITIAL_PLATFORM_START_Y)

        // 生成初始平台（从上到下分布）
        for (let i = 0; i < INITIAL_PLATFORM_ROWS; i++) {
            const y = initialPlatformStartY + i * this.platformGap
            this._createPlatformRow(scene, y)
        }
        // 记录最后一行平台的位置
        this.lastPlatformY = initialPlatformStartY + (INITIAL_PLATFORM_ROWS - 1) * this.platformGap

        // 玩家 - 在屏幕上方开始
        const startY = this.scaleValue(PLAYER_START_Y)
        this.player = scene.physics.add.sprite(width / 2, startY, this.assets.player.walk)
        this.player.setCollideWorldBounds(false)
        
        // 显示尺寸随分辨率缩放
        const displayWidth = this.scaleValue(BASE_PLAYER_DISPLAY_SIZE.width)
        const displayHeight = this.scaleValue(BASE_PLAYER_DISPLAY_SIZE.height)
        this.player.setDisplaySize(displayWidth, displayHeight)
        this.player.setBounce(0)

        // 计算缩放与原始帧大小的关系（Arcade Body 的尺寸以原始帧像素为单位）
        const frameWidth = this.player.frame.width
        const frameHeight = this.player.frame.height
        const scaleX = displayWidth / frameWidth
        const scaleY = displayHeight / frameHeight

        // 目标碰撞体尺寸（显示坐标系）
        const desiredBodyWidth = this.scaleValue(BASE_PLAYER_BODY_SIZE.width)
        const desiredBodyHeight = this.scaleValue(BASE_PLAYER_BODY_SIZE.height)
        const desiredOffsetX = (displayWidth - desiredBodyWidth) / 2
        const desiredOffsetY = displayHeight - desiredBodyHeight - this.scaleValue(BASE_PLAYER_BODY_SIZE.bottomPadding)

        // 换算到原始帧坐标系（Arcade Body 需要未缩放尺寸）
        const physicsBodyWidth = Math.round(desiredBodyWidth / scaleX)
        const physicsBodyHeight = Math.round(desiredBodyHeight / scaleY)
        const physicsOffsetX = Math.round(desiredOffsetX / scaleX)
        const physicsOffsetY = Math.round(desiredOffsetY / scaleY)

        this.player.body.setSize(physicsBodyWidth, physicsBodyHeight)
        this.player.body.setOffset(physicsOffsetX, physicsOffsetY)
        this.player.body.updateFromGameObject()

        this.player.setMaxVelocity(this.scaleValue(250), this.scaleValue(600))
        
        // 确保玩家底部碰撞检测开启
        this.player.body.checkCollision.down = true

        // 动画
        scene.anims.create({
            key: 'man-walk',
            frames: scene.anims.generateFrameNumbers(this.assets.player.walk, { start: 0, end: 34 }),
            frameRate: 30,
            repeat: -1
        })
        scene.anims.create({
            key: 'man-jump',
            frames: scene.anims.generateFrameNumbers(this.assets.player.jump, { start: 0, end: 34 }),
            frameRate: 30,
            repeat: 0
        })
        scene.anims.create({
            key: 'man-idle',
            frames: [{ key: this.assets.player.jump, frame: 1 }],
            frameRate: 1
        })

        // 碰撞 - 使用自定义处理函数
        scene.physics.add.collider(this.player, this.platforms, this._onPlatformCollide, null, this)
        scene.physics.add.collider(this.player, this.topBarrier, () => this._onTopBarrierHit(scene))

        // 输入
        this.cursors = scene.input.keyboard.createCursorKeys()
        this.jumpKey = scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE)

        // 触摸控制
        this.activeTouchDirection = 0
        this.pointerHalfWidth = width / 2
        scene.input.on('pointerdown', this._handlePointerDown, this)
        scene.input.on('pointermove', this._handlePointerMove, this)
        scene.input.on('pointerup', this._handlePointerUp, this)
        scene.input.on('pointerupoutside', this._handlePointerUp, this)
        scene.input.on('gameout', this._handlePointerUp, this)

        // HUD
        this.levelText = scene.add.text(this.scaleValue(HUD_LEVEL_POS.x), this.scaleValue(HUD_LEVEL_POS.y), '', {
            fontSize: `${this.scaleValue(18)}px`,
            fill: '#ffffff'
        })

        this.infoText = scene.add.text(this.scaleValue(HUD_LEVEL_POS.x), this.scaleValue(HUD_LEVEL_POS.infoY), '', {
            fontSize: `${this.scaleValue(14)}px`,
            fill: '#ffffff'
        })

        this._updateLevelText()

        // 结算 UI
        this.gameOverBanner = scene.add.image(width / 2, height / 2 - 40, this.assets.ui.gameOver)
        this.gameOverBanner.setDepth(20)
        this.gameOverBanner.visible = false

        this.restartButton = scene.add.image(width / 2, height / 2 + 40, this.assets.ui.restart).setInteractive()
        this.restartButton.setDepth(20)
        this.restartButton.visible = false
        this.restartButton.on('pointerdown', () => this.restartGame())

        this.quitButton = scene.add.image(width / 2, height / 2 + 110, this.assets.ui.quit).setInteractive()
        this.quitButton.setDepth(20)
        this.quitButton.visible = false
        this.quitButton.on('pointerdown', () => this.quitGame())

        // 触摸控制
        this.activeTouchDirection = 0
        this.pointerHalfWidth = width / 2
        scene.input.on('pointerdown', this._handlePointerDown, this)
        scene.input.on('pointermove', this._handlePointerMove, this)
        scene.input.on('pointerup', this._handlePointerUp, this)
        scene.input.on('pointerupoutside', this._handlePointerUp, this)
        scene.input.on('gameout', this._handlePointerUp, this)

        // 初始状态
        this.gameOver = false
        this.gameStarted = true
        this.score = 0
        this.lives = MAN_MAX_LIVES
        this.startTime = scene.time.now
        this._updateInfoText()
    }

    /**
     * 平台碰撞回调 - 当玩家站在平台上时，让玩家跟随平台移动
     */
    _onPlatformCollide(player, platform) {
        // 玩家从上方落下站在平台上时
        if (player.body.touching.down && platform.body.touching.up) {
            const platformType = platform.getData('type')
            
            // 弹性平台 - 给玩家一个向上的弹跳速度
            if (platformType === PLATFORM_TYPE.BOUNCE) {
                player.body.setVelocityY(this.scaleValue(-320)) // 向上弹跳
                // 弹跳视觉效果
                this._playBounceEffect(platform)
                return // 弹跳后不需要跟随平台
            }
            
            // 让玩家跟随平台向上移动
            player.y += this.platformScrollSpeed * (1 / 60) // 假设60fps
            
            // 毒性平台 - 扣除生命值（只触发一次）
            if (platformType === PLATFORM_TYPE.POISON && !platform.getData('triggered')) {
                platform.setData('triggered', true)
                // 中毒后扣除1点生命值
                this.lives -= 1
                if (this.lives <= 0) {
                    this.lives = 0
                } else {
                    // 毒性视觉效果
                    this._playPoisonEffect(player)
                }
                this._updateInfoText()
            }
            
            // 如果是易碎平台，触发消失倒计时
            if (platformType === PLATFORM_TYPE.FRAGILE && !platform.getData('triggered')) {
                platform.setData('triggered', true)
                // 开始闪烁效果
                this._startFragilePlatformEffect(platform)
            }
        }
    }

    _onTopBarrierHit(scene) {
        if (this.gameOver)
            return
        this._onPlayerDeath(scene, '被顶部锯齿击中！')
    }
        /**
     * 弹性平台效果 - 压缩回弹动画
     */
    _playPoisonEffect(player) {
        // 闪烁效果
        let blinkCount = 0
        const blinkInterval = setInterval(() => {
            if (!player.active) {
                clearInterval(blinkInterval)
                return
            }
            player.setAlpha(player.alpha === 1 ? 0.3 : 1)
            blinkCount++
        }, 100)

        setTimeout(() => {
            clearInterval(blinkInterval)
            if (player.active) {
                player.setAlpha(1)
                player.refreshBody()
            }
        }, 600)
    }

    /**
     * 弹性平台效果 - 压缩回弹动画
     */
    _playBounceEffect(platform) {
        // 保存原始缩放
        const originalScaleY = platform.scaleY
        
        // 压缩效果
        platform.setScale(platform.scaleX * 1.1, originalScaleY * 0.5)
        
        // 回弹恢复
        setTimeout(() => {
            if (platform.active) {
                platform.setScale(platform.scaleX / 1.1, originalScaleY)
                platform.refreshBody()
            }
        }, 100)
    }
    
    /**
     * 易碎平台效果 - 闪烁后消失
     */
    _startFragilePlatformEffect(platform) {
        // 闪烁效果
        let blinkCount = 0
        const blinkInterval = setInterval(() => {
            if (!platform.active) {
                clearInterval(blinkInterval)
                return
            }
            platform.setAlpha(platform.alpha === 1 ? 0.3 : 1)
            blinkCount++
        }, 100)
        
        // 0.4秒后销毁平台
        setTimeout(() => {
            clearInterval(blinkInterval)
            if (platform.active) {
                platform.destroy()
            }
        }, 400)
    }

    _handlePointerDown(pointer) {
        if (this.gameOver || !this.gameStarted)
            return
        const halfWidth = this.pointerHalfWidth || (pointer.manager && pointer.manager.game
            ? pointer.manager.game.scale.width / 2
            : pointer.x)
        this.activeTouchDirection = pointer.x < halfWidth ? -1 : 1
    }

    _handlePointerMove(pointer) {
        if (pointer.isDown) {
            this._handlePointerDown(pointer)
        }
    }

    _handlePointerUp() {
        this.activeTouchDirection = 0
    }

    /**
     * 帧更新
     */
    update(scene, time, delta) {
        if (this.gameOver || !this.gameStarted)
            return

        const { width, height } = scene.scale

        // 背景向上滚动
        this.backgroundTile.tilePositionY += this.platformScrollSpeed * (delta / 1000) * 0.5

        // 更新所有平台位置（手动移动静态平台）
        const platforms = this.platforms.getChildren()
        const moveAmount = this.platformScrollSpeed * (delta / 1000)
        
        for (let i = platforms.length - 1; i >= 0; i--) {
            const platform = platforms[i]
            
            // 移动平台
            platform.y += moveAmount
            // 同步物理体位置
            // body.position 是物理体左上角，sprite.y 是精灵中心
            // 需要用 refreshBody() 或手动计算：body.y = sprite.y - (displayHeight * originY)
            platform.refreshBody()
            
            // 移除超出屏幕顶部的平台
            if (platform.y < -this.scaleValue(PLATFORM_DESPAWN_OFFSET)) {
                platform.destroy()
            }
        }

        // 更新最后平台位置（跟随滚动）
        this.lastPlatformY += moveAmount

        // 基于距离生成新平台：当最后一行平台滚动到屏幕内时，在屏幕下方生成新平台
        while (this.lastPlatformY < height) {
            const newY = this.lastPlatformY + this.platformGap
            this._createPlatformRow(scene, newY)
            this.lastPlatformY = newY
            this.currentLevel++
            this._updateLevelText()
        }

        // 玩家控制
        const body = this.player.body
        const moveSpeed = this.scaleValue(220)

        const leftPressed = this.cursors.left.isDown || this.activeTouchDirection === -1
        const rightPressed = this.cursors.right.isDown || this.activeTouchDirection === 1

        // 水平移动 - 只在按键或触控时设置速度，不按键时让物理引擎自然处理
        if (leftPressed && !rightPressed) {
            body.setVelocityX(-moveSpeed)
            this.player.setFlipX(false)
            this.player.anims.play('man-walk', true)
        } else if (rightPressed && !leftPressed) {
            body.setVelocityX(moveSpeed)
            this.player.setFlipX(true)
            this.player.anims.play('man-walk', true)
        } else {
            // 不输入时应用摩擦力减速，但不要每帧强制设置
            if (Math.abs(body.velocity.x) > 1) {
                body.setVelocityX(body.velocity.x * 0.8)
            } else if (body.velocity.x !== 0) {
                body.setVelocityX(0)
            }
            this.player.anims.play('man-idle', true)
        }
        // 左右边界循环
        if (this.player.x < 0) {
            this.player.x = 0
        } else if (this.player.x > width) {
            this.player.x = width
        }

        // 死亡判定：被顶出屏幕顶部
        if (this.player.y < this.scaleValue(PLAYER_TOP_DEATH_OFFSET)) {
            this._onPlayerDeath(scene, '被顶出屏幕！')
        }

        // 死亡判定：掉出屏幕底部
        if (this.player.y >= height - this.scaleValue(PLAYER_BOTTOM_DEATH_OFFSET)) {
            this._onPlayerDeath(scene, '掉出屏幕！')
        }
        if (this.lives <=0 ){
            this._onPlayerDeath(scene, 'HP归零！')
        }
    }

    /**
     * 创建一行平台（带洞）
     * 规则：至少有1/4屏幕宽度的平台，至少有1/3屏幕宽度的hole
     */
    _createPlatformRow(scene, y) {
        const { width } = scene.scale
        const minPlatformWidth = width / 4  // 最小平台宽度：1/4屏幕
        const minHoleWidth = width / 3      // 最小hole宽度：1/3屏幕
        
        // 随机生成hole的宽度（1/3 到 2/3 屏幕宽度）
        const holeWidth = Phaser.Math.Between(minHoleWidth, width * 1 / 2)
        
        // 随机生成hole的起始位置（确保hole在屏幕内）
        const holeStart = Phaser.Math.Between(0, width - holeWidth)
        const holeEnd = holeStart + holeWidth
        
        // 计算左侧平台和右侧平台的空间
        const leftSpace = holeStart
        const rightSpace = width - holeEnd
        
        // 创建左侧平台（如果空间足够）
        if (leftSpace >= minPlatformWidth) {
            // 随机平台宽度（minPlatformWidth 到 leftSpace）
            const platformWidth = Phaser.Math.Between(minPlatformWidth, leftSpace)
            // 平台靠右放置（紧贴hole）或随机位置
            const platformX = Phaser.Math.Between(0, leftSpace - platformWidth) + platformWidth / 2
            this._createSinglePlatform(scene, platformX, y, platformWidth)
        }
        
        // 创建右侧平台（如果空间足够）
        if (rightSpace >= minPlatformWidth) {
            // 随机平台宽度（minPlatformWidth 到 rightSpace）
            const platformWidth = Phaser.Math.Between(minPlatformWidth, rightSpace)
            // 平台随机位置
            const platformX = holeEnd + Phaser.Math.Between(0, rightSpace - platformWidth) + platformWidth / 2
            this._createSinglePlatform(scene, platformX, y, platformWidth)
        }
    }
    
    /**
     * 创建单个平台
     */
    _createSinglePlatform(scene, x, y, platformWidth) {
        const platform = this.platforms.create(x, y, this.assets.platform)
        platform.setScale(platformWidth / platform.width, 0.4)
        
        // 随机决定平台类型（60%普通，25%易碎，15%弹性）
        const rand = Phaser.Math.Between(1, 100)
        let platformType = PLATFORM_TYPE.NORMAL
        if (rand <= 20) {
            platformType = PLATFORM_TYPE.FRAGILE
        } else if (rand <= 33) {
            platformType = PLATFORM_TYPE.BOUNCE
        }else if (rand <= 40) {
            platformType = PLATFORM_TYPE.POISON
        }
        
        platform.setData('type', platformType)
        platform.setData('triggered', false)
        
        // 不同平台类型用不同颜色标识
        if (platformType === PLATFORM_TYPE.FRAGILE) {
            platform.setTint(0xff6666) // 红色 - 易碎
        } else if (platformType === PLATFORM_TYPE.BOUNCE) {
            platform.setTint(0xffff00) // 黄色 - 弹性
        } else if (platformType === PLATFORM_TYPE.POISON) {
            platform.setTint(0x111111) // 黑色 - 毒性
        }
        
        // 刷新物理体以匹配缩放后的大小
        platform.refreshBody()
    }

    /**
     * 玩家死亡
     */
    _onPlayerDeath(scene, reason) {
        if (this.gameOver)
            return

        this.gameOver = true
        this.gameStarted = false
        
        // 更新最佳记录
        if (this.currentLevel > this.bestLevel) {
            this.bestLevel = this.currentLevel
            localStorage.setItem('man_down_best_level', this.bestLevel.toString())
        }

        this._showResultUI(scene, reason)
    }

    /**
     * Man Down 100 进入场景即开始，无需额外 startGame 逻辑
     */
    startGame(scene) {
        this.gameStarted = true
    }

    /**
     * 如后续需要"重新准备关卡"，可以在这里重生玩家和平台
     */
    prepareGame(scene) {
        // 当前实现中，通过 restartGame() 直接整局重开
    }

    /**
     * 重新开始游戏：简单处理为刷新页面
     */
    restartGame() {
        window.location.reload()
    }

    /**
     * 更新 HUD 中的分数显示
     */
    updateScoreboard() {
        this._updateLevelText()
    }

    /**
     * 退出到主菜单
     */
    quitGame() {
        window.location.href = 'index.html'
    }

    // ======================
    // 内部辅助方法
    // ======================

    _showResultUI(scene, reason) {
        this.gameOverBanner.visible = true
        this.restartButton.visible = true
        this.quitButton.visible = true

        const resultText = `${reason}\n到达第 ${this.currentLevel} 层`

        this.infoText.setText(
            `${resultText}\n历史最佳：${this.bestLevel} 层`
        )
    }

    _updateLevelText() {
        if (this.levelText)
            this.levelText.setText(`层数：${this.currentLevel}`)
        this._updateInfoText()
    }

    _updateInfoText() {
        if (!this.infoText)
            return
        this.infoText.setText(`生命：${this.lives}`)
    }
}

// 启动游戏
manDownGameInstance = createPhaserGame(ManDownGame)
