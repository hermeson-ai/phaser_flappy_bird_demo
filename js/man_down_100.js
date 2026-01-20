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

const BASE_PLAYER_DISPLAY_SIZE = { width: 40, height: 70 }
const BASE_PLAYER_BODY_SIZE = { width: 34, height: 62, bottomPadding: 4 }
const HUD_LEVEL_POS = { x: 10, y: 10, infoY: 28 }
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
 * Game assets manifest path.
 */
const MAN_DOWN_MANIFEST_PATH = 'manifest_man_down_100.json'

/**
 * Game assets - 将从 manifest 文件动态构建
 */
let manDownAssets = null

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

        // assets 将在 preload 中从 manifest 构建
        this.assets = null
        this.manifestLoaded = false

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
        this.lastPlatformY = 0 // 记录最后一行平台的位置
        this.platformGap = this.scaleValue(MAN_LEVEL_GAP_BASE) // 平台之间的固定间距
    }

    /**
     * 资源加载 - 从 manifest 文件读取配置
     * @param {Phaser.Scene} scene
     */
    preload(scene) {
        // 使用同步方式加载 manifest（在 preload 阶段可以使用同步方式）
        try {
            const xhr = new XMLHttpRequest()
            xhr.open('GET', MAN_DOWN_MANIFEST_PATH, false) // false 表示同步
            xhr.send(null)
            
            if (xhr.status === 200) {
                const manifest = JSON.parse(xhr.responseText)
                this._loadAssetsFromManifest(scene, manifest)
            } else {
                throw new Error(`HTTP ${xhr.status}: ${xhr.statusText}`)
            }
        } catch (error) {
            console.error('Failed to load manifest:', error)
            console.warn('Using fallback asset loading')
            // 降级方案：使用硬编码的资源路径
            this._loadAssetsFallback(scene)
        }
    }
    
    /**
     * 根据 manifest 加载所有资源
     * @param {Phaser.Scene} scene
     * @param {object} manifest
     */
    _loadAssetsFromManifest(scene, manifest) {
        // 根据 manifest 构建 assets 对象（嵌套结构）
        manDownAssets = this._buildAssetsFromManifest(manifest.assets)
        this.assets = manDownAssets
        this.manifestLoaded = true
        
        // 根据 manifest 配置加载资源
        manifest.assets.forEach(asset => {
            const assetKey = this._getAssetKey(asset.id)
            
            if (asset.type === 'sprite') {
                console.log("[_loadAssetsFromManifest] spritesheet: assetKey = ", assetKey, " asset.path = ", asset.path);
                scene.load.spritesheet(assetKey, asset.path, {
                    frameWidth: asset.frameWidth,
                    frameHeight: asset.frameHeight
                })
            } else if (asset.type === 'image') {
                console.log("[_loadAssetsFromManifest] image: assetKey = ", assetKey, " asset.path = ", asset.path);
                scene.load.image(assetKey, asset.path)
            }
        })
    }
    
    /**
     * 根据 manifest 数据构建嵌套的 assets 对象
     * 例如 "background.stone" -> { background: { stone: "background.stone" } }
     */
    _buildAssetsFromManifest(assetsArray) {
        const assetsObj = {}
        
        assetsArray.forEach(asset => {
            const parts = asset.id.split('.')
            let current = assetsObj
            
            // 创建嵌套结构
            for (let i = 0; i < parts.length - 1; i++) {
                if (!current[parts[i]]) {
                    current[parts[i]] = {}
                }
                current = current[parts[i]]
            }
            
            // 设置最终值（使用完整的 id 作为 key）
            current[parts[parts.length - 1]] = asset.id
        })
        
        return assetsObj
    }
    
    /**
     * 获取资源在 Phaser 中的 key
     * 可以直接使用 id，或者根据需要转换
     */
    _getAssetKey(id) {
        return id
    }
    
    /**
     * 降级方案：如果 manifest 加载失败，使用硬编码的资源路径
     */
    _loadAssetsFallback(scene) {
        console.warn('Using fallback asset loading')
        // 构建基础的 assets 对象
        this.assets = {
            background: {
                stone: 'background.stone',
                road: 'background.road',
                sea: 'background.sea',
                default: 'background.default'
            },
            platform: 'platform',
            topBarrier: 'topBarrier',
            player: {
                walk: 'player.walk',
                jump: 'player.jump'
            },
            ui: {
                gameOver: 'ui.gameOver',
                restart: 'ui.restart',
                quit: 'ui.quit'
            }
        }
        
        // 硬编码加载资源
        scene.load.image('background.stone', 'assets/bg_stone.png')
        scene.load.image('background.sea', 'assets/bg_sea.png')
        scene.load.image('background.road', 'assets/bg_road.png')
        scene.load.image('background.default', 'assets/sky_cloud.png')
        scene.load.image('platform', 'assets/platform.png')
        scene.load.image('topBarrier', 'assets/top.png')
        scene.load.spritesheet('player.walk', 'assets/avatar_walk_sprite.png', {
            frameWidth: 198,
            frameHeight: 341
        })
        scene.load.spritesheet('player.jump', 'assets/avatar_jump3_sprite.png', {
            frameWidth: 198,
            frameHeight: 341
        })
        
        scene.load.image('ui.gameOver', 'assets/gameover.png')
        scene.load.image('ui.restart', 'assets/restart-button.png')
        scene.load.image('ui.quit', 'assets/back-button.png')
    }

    /**
     * 创建场景
     * @param {Phaser.Scene} scene
     */
    create(scene) {
        const { width, height } = scene.scale
        let background = this.assets.background.default
        switch (Phaser.Math.Between(0, 3)) {
            case 0:
                background = this.assets.background.night0
                break
            case 1:
                background = this.assets.background.night1
                break
            case 2:
                background = this.assets.background.night1
                break
            case 3:
                background = this.assets.background.default
                break
        }

        // 背景（缩放填充整个屏幕）
        this.backgroundImage = scene.add.image(width / 2, height / 2, background)
        // 计算缩放比例，确保图片覆盖整个屏幕（cover 模式）
        const bgScaleX = width / this.backgroundImage.width
        const bgScaleY = height / this.backgroundImage.height
        // const bgScale = Math.max(bgScaleX, bgScaleY) // 使用较大的缩放比例确保完全覆盖
        this.backgroundImage.setScale(bgScaleX,bgScaleY)
        this.backgroundImage.setDepth(-1) // 确保在最底层
        
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
            frameRate: 40,
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
            fontFamily: 'Georgia, "Goudy Bookletter 1911", Times, serif',
            fontSize: `${this.scaleValue(12)}px`,
            fill: '#ffffff'
        })
        this.infoText = scene.add.text(this.scaleValue(HUD_LEVEL_POS.x), this.scaleValue(HUD_LEVEL_POS.infoY), '', {
            fontFamily: 'Georgia, "Goudy Bookletter 1911", Times, serif',
            fontSize: `${this.scaleValue(10)}px`,
            fill: '#ffffff'
        })
        this.infoText.setDepth(20)
        this.levelText.setDepth(20)
        this._updateLevelText()

        // 结算 UI
        scene.anims.create({
            key: 'gameOverAnim',
            frames: scene.anims.generateFrameNumbers(this.assets.ui.gameOverAnim, { start: 0, end: 64 }),
            frameRate: 50,
            repeat: 0
        })
        const bannerHeight = this.scaleValue(42)
        const bannerWidth = this.scaleValue(200)
        this.gameOverBanner = scene.add.image(width / 2, height / 2 - bannerHeight / 2-20, this.assets.ui.gameOver)
        this.gameOverBanner.setDisplaySize(bannerWidth, bannerHeight)
        this.gameOverBanner.setDepth(20)
        this.gameOverBanner.visible = false

        const buttonHeight = this.scaleValue(30)
        const buttonWidth = this.scaleValue(100)
        this.restartButton = scene.add.image(width / 2, height / 2 + buttonHeight / 2 + 30, this.assets.ui.restart).setInteractive()
        this.restartButton.setDisplaySize(buttonWidth, buttonHeight)
        this.restartButton.setDepth(20)
        this.restartButton.visible = false
        this.restartButton.on('pointerdown', () => this.restartGame())

        this.quitButton = scene.add.image(width / 2, height / 2 + 20 + buttonHeight * 2 + 10, this.assets.ui.quit).setInteractive()
        this.quitButton.setDisplaySize(buttonWidth, buttonHeight)
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
                // 销毁平台时，同时销毁对应的所有光晕层
                const glowLayersToDestroy = platform.getData('glowLayers')
                if (glowLayersToDestroy && Array.isArray(glowLayersToDestroy)) {
                    glowLayersToDestroy.forEach(glowLayer => {
                        if (glowLayer && glowLayer.active) {
                            glowLayer.destroy()
                        }
                    })
                }
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
        // this.backgroundTile.tilePositionY += this.platformScrollSpeed * (delta / 1000) * 0.5

        // 更新所有平台位置（手动移动静态平台）
        const platforms = this.platforms.getChildren()
        const moveAmount = this.platformScrollSpeed * (delta / 1000)
        
        for (let i = platforms.length - 1; i >= 0; i--) {
            const platform = platforms[i]
            
            // 移动平台
            platform.y += moveAmount
            
            // 同步更新光晕位置和缩放（如果存在）
            const glowLayers = platform.getData('glowLayers')
            if (glowLayers && Array.isArray(glowLayers)) {
                const glowScaleFactor = platform.getData('glowScaleFactor') || 1.15
                
                glowLayers.forEach((glowLayer, index) => {
                    if (glowLayer && glowLayer.active) {
                        // 同步位置
                        glowLayer.x = platform.x
                        glowLayer.y = platform.y
                        
                        // 同步缩放 - 保持渐变比例
                        const layerScale = 1 + (glowScaleFactor - 1) * (index + 1) / glowLayers.length
                        glowLayer.setScale(platform.scaleX * layerScale, platform.scaleY * layerScale)
                    }
                })
            }
            
            // 同步物理体位置
            // body.position 是物理体左上角，sprite.y 是精灵中心
            // 需要用 refreshBody() 或手动计算：body.y = sprite.y - (displayHeight * originY)
            platform.refreshBody()
            
            // 移除超出屏幕顶部的平台
            if (platform.y < -this.scaleValue(PLATFORM_DESPAWN_OFFSET)) {
                // 销毁平台时，同时销毁对应的所有光晕层
                const glowLayersToDestroy = platform.getData('glowLayers')
                if (glowLayersToDestroy && Array.isArray(glowLayersToDestroy)) {
                    glowLayersToDestroy.forEach(glowLayer => {
                        if (glowLayer && glowLayer.active) {
                            glowLayer.destroy()
                        }
                    })
                }
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
        platform.setScale(platformWidth / platform.width, 0.32)
        
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
        
        // 不同平台类型用不同颜色标识和光晕配置
        let glowColor = 0x00ff00 // 默认绿色光晕
        let glowAlpha = 0.5 // 默认光晕透明度
        let glowScaleFactor = 1.15 // 光晕缩放系数
        
        if (platformType === PLATFORM_TYPE.FRAGILE) {
            platform.setTint(0xff6666) // 红色 - 易碎
            glowColor = 0xff3333 // 红色光晕，更亮
            glowAlpha = 0.6
            glowScaleFactor = 1.2
        } else if (platformType === PLATFORM_TYPE.BOUNCE) {
            platform.setTint(0xffff00) // 黄色 - 弹性
            glowColor = 0xffff33 // 黄色光晕
            glowAlpha = 0.7
            glowScaleFactor = 1.18
        } else if (platformType === PLATFORM_TYPE.POISON) {
            platform.setTint(0x111111) // 黑色 - 毒性
            glowColor = 0x9900ff // 紫色光晕
            glowAlpha = 0.6
            glowScaleFactor = 1.15
        } else {
            // 普通平台 - 绿色光晕
            glowColor = 0x00ff00
            glowAlpha = 0.5
            glowScaleFactor = 1.12
        }
        
        // 创建多层渐变光晕效果 - 使用多个逐渐变大的光晕层
        const glowLayers = []
        const glowLayerCount = 3 // 光晕层数，层数越多渐变越平滑
        
        // 从内到外创建多层光晕
        for (let i = 0; i < glowLayerCount; i++) {
            const layerScale = 1 + (glowScaleFactor - 1) * (i + 1) / glowLayerCount // 逐渐增大
            const layerAlpha = glowAlpha * (1 - i * 0.3) / Math.pow(i + 1, 0.8) // 逐渐降低透明度
            
            // const glowLayer = scene.add.image(x, y, this.assets.platform)
            // glowLayer.setScale(platform.scaleX * layerScale, platform.scaleY * layerScale)
            // glowLayer.setTint(glowColor)
            // glowLayer.setAlpha(layerAlpha)
            // glowLayer.setBlendMode(Phaser.BlendModes.ADD) // 加色混合模式，增强发光效果
            // glowLayer.setDepth(1) // 确保光晕在平台下方
            
            // glowLayers.push(glowLayer)
        }
        
        platform.setDepth(2) // 平台在上方
        
        // 将光晕对象数组存储到平台数据中，方便后续更新和清理
        platform.setData('glowLayers', glowLayers)
        platform.setData('glowScaleFactor', glowScaleFactor)
        
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
