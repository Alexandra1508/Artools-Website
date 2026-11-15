document.addEventListener('DOMContentLoaded', () => {
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const hasGSAP = typeof window.gsap !== 'undefined' && typeof window.ScrollTrigger !== 'undefined';
    const hasScrollTo = typeof window.ScrollToPlugin !== 'undefined';

    if (hasGSAP) {
        gsap.registerPlugin(ScrollTrigger);
        if (typeof window.SplitText !== 'undefined') gsap.registerPlugin(SplitText);
        if (hasScrollTo) gsap.registerPlugin(ScrollToPlugin);
    }

    /* ----------------------------------------------------------------
       1. LENIS SMOOTH SCROLL (Integrado ao GSAP Ticker sem dessincronia)
    ---------------------------------------------------------------- */
    let lenis = null;
    if (hasGSAP && !prefersReducedMotion && typeof window.Lenis !== 'undefined' && window.innerWidth >= 1024) {
        lenis = new Lenis({
            duration: 0.85,
            easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
            smoothWheel: true,
            wheelMultiplier: 1.0,
            touchMultiplier: 1.4
        });

        lenis.on('scroll', ScrollTrigger.update);
        gsap.ticker.add((time) => {
            lenis.raf(time * 1000);
        });
        gsap.ticker.lagSmoothing(0);
    }

    /* ----------------------------------------------------------------
       2. CONFIGURAÇÕES DE ANIMAÇÃO DE ENTRADA (DESIGN SYSTEM BLUR + FADE IN)
    ---------------------------------------------------------------- */
    const siteHeader = document.getElementById('site-header');
    if (siteHeader) {
        requestAnimationFrame(() => siteHeader.classList.add('loaded'));
    }

    const headerItems = document.querySelectorAll('.js-header-item');
    const fadeItems = document.querySelectorAll('.js-hero-fade');
    const ctaItems = document.querySelectorAll('.js-hero-cta');
    const heroTitle = document.getElementById('hero-title');

    let splitInstance = null;
    if (hasGSAP && !prefersReducedMotion && typeof window.SplitText !== 'undefined' && heroTitle) {
        const solidLines = heroTitle.querySelectorAll('.line-light, .line-solid');
        const outlineLine = heroTitle.querySelector('.line-outline');

        const introTl = gsap.timeline({ defaults: { ease: 'expo.out' } });

        // Header escalonado com blur in sutil
        introTl.from(headerItems, {
            y: -12,
            opacity: 0,
            filter: 'blur(6px)',
            duration: 0.8,
            stagger: 0.08,
            clearProps: 'filter'
        }, 0.05);

        // Revelação tipográfica (animationIn: translateY 28px + blur 10px + fade)
        splitInstance = new SplitText(solidLines, { type: 'words', tag: 'span', wordsClass: 'split-word' });
        gsap.set(splitInstance.words, { display: 'inline-block' });

        introTl.from(splitInstance.words, {
            y: 28,
            opacity: 0,
            filter: 'blur(10px)',
            duration: 0.95,
            stagger: 0.055,
            clearProps: 'filter'
        }, 0.16);

        if (outlineLine) {
            introTl.from(outlineLine, {
                y: 28,
                opacity: 0,
                filter: 'blur(10px)',
                duration: 0.95,
                clearProps: 'filter'
            }, 0.3);
        }

        // Eyebrow, descrição, barra de capítulo e telemetria com blur-in + fade-in
        introTl.from(fadeItems, {
            y: 28,
            opacity: 0,
            filter: 'blur(10px)',
            duration: 0.9,
            stagger: 0.1,
            clearProps: 'filter'
        }, 0.38);

        // Botões com blur-in + fade-in sincronizados lado a lado sem conflito de transition CSS
        introTl.from(ctaItems, {
            y: 28,
            opacity: 0,
            filter: 'blur(10px)',
            duration: 0.85,
            stagger: 0,
            clearProps: 'transform,filter'
        }, 0.52);

        // Entrada sutil do canvas em tela cheia (apenas opacidade, sem deformar ou encolher as bordas)
        const penCanvasEl = document.getElementById('pen-canvas');
        if (penCanvasEl) {
            introTl.from(penCanvasEl, {
                opacity: 0,
                duration: 0.9,
                ease: 'power2.out'
            }, 0.12);
        }
    }

    // Observer para .reveal e .text-reveal-wrapper das seções inferiores (Design System)
    const revealObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                entry.target.classList.add('active');
                if (entry.target.querySelector('.text-reveal-content') || entry.target.classList.contains('text-reveal-wrapper')) {
                    entry.target.classList.add('reveal-active');
                }
            }
        });
    }, { threshold: 0.12 });

    document.querySelectorAll('.reveal').forEach((el) => revealObserver.observe(el));
    document.querySelectorAll('h2').forEach((el) => {
        if (el.querySelector('.text-reveal-content')) revealObserver.observe(el);
    });

    /* ----------------------------------------------------------------
       3. SEQUÊNCIA CANVAS + WEBP (SCRUBBING 60–120FPS BIDIRECIONAL)
          Cada posição do scroll mapeia diretamente para 192 frames WebP
          pré-decodificados em memória, eliminando gargalos de keyframes H.264.
    ---------------------------------------------------------------- */
    const stage = document.getElementById('video-stage');
    const canvas = document.getElementById('pen-canvas');
    const ctx = canvas ? canvas.getContext('2d', { alpha: false }) : null;
    const fallbackEl = document.getElementById('video-fallback');
    const scrubFill = document.getElementById('scrub-fill');
    const scrubKnob = document.getElementById('scrub-knob');
    const scrubPercent = document.getElementById('scrub-percent');
    const timecodeEl = document.getElementById('video-timecode');
    const chapterCodeEl = document.getElementById('chapter-code');
    const chapterCaptionEl = document.getElementById('chapter-caption');
    const scrollCueEl = document.getElementById('scroll-cue');
    const stepEls = document.querySelectorAll('.scrub-step');

    const TOTAL_FRAMES = 192;
    const VIDEO_DURATION = 8.0;
    const FRAME_PATH_PREFIX = 'assets/frames/frame_';
    const MAX_CONCURRENT_LOADS = 8;

    const chapters = [
        { threshold: 0, code: '01', label: 'Silhueta monobloco em estúdio', step: 0 },
        { threshold: 0.34, code: '02', label: 'Desacoplamento e equilíbrio tátil', step: 1 },
        { threshold: 0.68, code: '03', label: 'Ponta única calibrada para o traço', step: 2 }
    ];

    const scrubState = { rawProgress: 0, smoothProgress: 0 };
    const frameImages = new Array(TOTAL_FRAMES);
    const frameReady = new Uint8Array(TOTAL_FRAMES); // 0 = pendente, 1 = pronto, 2 = erro
    const loadQueue = [];
    let activeLoads = 0;
    let lastDrawnFrameIdx = -1;
    let activeChapterIdx = -1;
    let scrollTriggerReady = false;

    const clamp = (val, min, max) => Math.min(Math.max(val, min), max);

    function getFrameUrl(index) {
        return `${FRAME_PATH_PREFIX}${String(index + 1).padStart(4, '0')}.webp`;
    }

    function findNearestReadyFrame(targetIdx) {
        const idx = clamp(targetIdx, 0, TOTAL_FRAMES - 1);
        if (frameReady[idx] === 1) return idx;
        for (let offset = 1; offset < TOTAL_FRAMES; offset++) {
            const prev = idx - offset;
            if (prev >= 0 && frameReady[prev] === 1) return prev;
            const next = idx + offset;
            if (next < TOTAL_FRAMES && frameReady[next] === 1) return next;
        }
        return -1;
    }

    function drawFrame(targetIdx, force = false) {
        if (!canvas || !ctx || canvas.width === 0 || canvas.height === 0) return;
        const resolvedIdx = findNearestReadyFrame(targetIdx);
        if (resolvedIdx < 0) return;
        if (!force && resolvedIdx === lastDrawnFrameIdx) return;

        const img = frameImages[resolvedIdx];
        if (!img || !img.naturalWidth || !img.naturalHeight) return;

        const cw = canvas.width;
        const ch = canvas.height;
        const iw = img.naturalWidth;
        const ih = img.naturalHeight;
        const isPortrait = stage ? stage.clientWidth <= stage.clientHeight : window.innerWidth <= window.innerHeight;

        if (isPortrait) {
            ctx.fillStyle = '#F2F2EF';
            ctx.fillRect(0, 0, cw, ch);
            const scale = Math.min(cw / iw, ch / ih);
            const dw = iw * scale;
            const dh = ih * scale;
            const dx = (cw - dw) * 0.5;
            const dy = (ch - dh) * 0.68;
            ctx.drawImage(img, dx, dy, dw, dh);
        } else {
            const scale = Math.max(cw / iw, ch / ih);
            const dw = iw * scale;
            const dh = ih * scale;
            const dx = (cw - dw) * 0.5;
            const dy = (ch - dh) * 0.5;
            ctx.drawImage(img, dx, dy, dw, dh);
        }

        lastDrawnFrameIdx = resolvedIdx;
    }

    function drawFrameForProgress(progress, force = false) {
        const p = clamp(progress, 0, 1);
        const targetIdx = Math.round(p * (TOTAL_FRAMES - 1));
        drawFrame(targetIdx, force);
    }

    function resizeCanvas() {
        if (!canvas || !stage) return;
        const w = stage.clientWidth || window.innerWidth;
        const h = stage.clientHeight || window.innerHeight;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const targetW = Math.max(1, Math.round(w * dpr));
        const targetH = Math.max(1, Math.round(h * dpr));

        if (canvas.width !== targetW || canvas.height !== targetH) {
            canvas.width = targetW;
            canvas.height = targetH;
            if (ctx) {
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
            }
            lastDrawnFrameIdx = -1;
            drawFrameForProgress(scrubState.smoothProgress, true);
        }
    }

    function loadSingleFrame(idx) {
        activeLoads++;
        const img = new Image();
        img.decoding = 'async';
        frameImages[idx] = img;

        const completeReady = () => {
            frameReady[idx] = 1;
            const desired = Math.round(clamp(scrubState.smoothProgress, 0, 1) * (TOTAL_FRAMES - 1));
            if (idx === 0) {
                resizeCanvas();
                drawFrameForProgress(scrubState.smoothProgress, true);
                initScrollExperience();
            } else if (
                lastDrawnFrameIdx < 0 ||
                Math.abs(idx - desired) < Math.abs(lastDrawnFrameIdx - desired)
            ) {
                drawFrameForProgress(scrubState.smoothProgress, true);
            }
            activeLoads--;
            pumpLoadQueue();
        };

        img.onload = () => {
            if (typeof img.decode === 'function') {
                img.decode().then(completeReady, completeReady);
            } else {
                completeReady();
            }
        };

        img.onerror = () => {
            frameReady[idx] = 2;
            if (idx === 0) {
                if (fallbackEl) fallbackEl.classList.add('is-visible');
                initScrollExperience();
            }
            activeLoads--;
            pumpLoadQueue();
        };

        img.src = getFrameUrl(idx);
    }

    function pumpLoadQueue() {
        while (activeLoads < MAX_CONCURRENT_LOADS && loadQueue.length > 0) {
            loadSingleFrame(loadQueue.shift());
        }
    }

    function enqueueRemainingFrames() {
        const queued = new Uint8Array(TOTAL_FRAMES);
        queued[0] = 1;

        const push = (idx) => {
            if (idx >= 0 && idx < TOTAL_FRAMES && !queued[idx]) {
                queued[idx] = 1;
                loadQueue.push(idx);
            }
        };

        // Prioriza marcos de capítulo e último quadro, depois passes espaçados (4 -> 2 -> 1)
        push(TOTAL_FRAMES - 1);
        push(Math.round(0.34 * (TOTAL_FRAMES - 1)));
        push(Math.round(0.68 * (TOTAL_FRAMES - 1)));
        for (let step of [4, 2, 1]) {
            for (let i = 0; i < TOTAL_FRAMES; i += step) {
                push(i);
            }
        }
        pumpLoadQueue();
    }

    function formatTimecode(seconds) {
        const safe = Math.max(0, seconds);
        const mins = String(Math.floor(safe / 60)).padStart(2, '0');
        const secs = String(Math.floor(safe % 60)).padStart(2, '0');
        const hundredths = String(Math.floor((safe % 1) * 100)).padStart(2, '0');
        return `${mins}:${secs}.${hundredths}`;
    }

    function updateTelemetryUI(progress) {
        const p = clamp(progress, 0, 1);
        const isDesktop = window.innerWidth > 1024;

        if (scrubFill) {
            scrubFill.style.transform = isDesktop ? `scaleY(${p})` : `scaleX(${p})`;
        }
        if (scrubKnob) {
            if (isDesktop) {
                scrubKnob.style.top = `${p * 100}%`;
                scrubKnob.style.left = '50%';
            } else {
                scrubKnob.style.left = `${p * 100}%`;
                scrubKnob.style.top = '50%';
            }
        }
        if (scrubPercent) {
            scrubPercent.textContent = `${String(Math.round(p * 100)).padStart(3, '0')}%`;
        }
        if (timecodeEl) {
            timecodeEl.textContent = formatTimecode(p * VIDEO_DURATION);
        }
        if (scrollCueEl) {
            scrollCueEl.style.opacity = p > 0.04 ? '0' : '1';
        }

        // Atualiza capítulo narrativo correspondente ao momento da sequência
        let nextIdx = 0;
        for (let i = chapters.length - 1; i >= 0; i--) {
            if (p >= chapters[i].threshold) {
                nextIdx = i;
                break;
            }
        }

        if (nextIdx !== activeChapterIdx) {
            activeChapterIdx = nextIdx;
            const ch = chapters[nextIdx];
            if (chapterCodeEl) chapterCodeEl.textContent = ch.code;
            if (chapterCaptionEl) chapterCaptionEl.textContent = ch.label;
            stepEls.forEach((el, idx) => {
                el.classList.toggle('is-active', idx === ch.step);
            });
        }
    }

    if (canvas && ctx) {
        resizeCanvas();
        if (typeof ResizeObserver !== 'undefined' && stage) {
            const stageObserver = new ResizeObserver(() => resizeCanvas());
            stageObserver.observe(stage);
        }

        // Ticker em rAF a 60–120Hz: interpolação exponencial suave direto no canvas
        if (hasGSAP) {
            gsap.ticker.add((time, deltaMs) => {
                const dt = Math.min(deltaMs || 16.67, 50);
                const lerpAlpha = 1 - Math.exp(-0.016 * dt);
                const diff = scrubState.rawProgress - scrubState.smoothProgress;

                if (Math.abs(diff) > 0.0001) {
                    scrubState.smoothProgress += diff * lerpAlpha;
                } else {
                    scrubState.smoothProgress = scrubState.rawProgress;
                }

                updateTelemetryUI(scrubState.smoothProgress);
                drawFrameForProgress(scrubState.smoothProgress);
            });
        }
    }

    /* ----------------------------------------------------------------
       4. SCROLLTRIGGER (PIN + SCRUB DIRETO + INÉRCIA UNIFICADA NO TICKER)
    ---------------------------------------------------------------- */
    let heroST = null;

    function getScrollDistance() {
        if (window.innerWidth <= 767) return 1800;
        if (window.innerWidth <= 1024) return 2400;
        return 3800;
    }

    function initScrollExperience() {
        if (scrollTriggerReady) return;
        scrollTriggerReady = true;

        const heroPin = document.getElementById('hero-pin');
        if (!heroPin) return;

        if (!hasGSAP || prefersReducedMotion) {
            updateTelemetryUI(0);
            drawFrame(0, true);
            initCinemaInteractiveListeners();
            if (hasGSAP) {
                initTechFoldAnimations();
                initLabFoldAnimations();
                initCinemaFoldAnimations();
            }
            return;
        }

        // scrub: true elimina atraso duplo entre Lenis e ScrollTrigger; a fluidez fina vem do ticker
        const scrubTl = gsap.timeline({
            scrollTrigger: {
                trigger: heroPin,
                start: 'top top',
                end: () => `+=${getScrollDistance()}`,
                pin: true,
                pinSpacing: true,
                scrub: true,
                anticipatePin: 1,
                invalidateOnRefresh: true,
                onUpdate: (self) => {
                    scrubState.rawProgress = self.progress;
                }
            }
        });

        // Desvanece com Blur Out + Fade Out + Slide Up ao descer e reverte ao subir (espelho de @keyframes animationIn)
        const scrollFadeBlocks = document.querySelectorAll('.js-scroll-fade');
        if (scrollFadeBlocks.length) {
            scrubTl.fromTo(scrollFadeBlocks,
                {
                    y: 0,
                    autoAlpha: 1,
                    filter: 'blur(0px)'
                },
                {
                    y: -28,
                    autoAlpha: 0,
                    filter: 'blur(10px)',
                    ease: 'power2.inOut',
                    stagger: 0.025,
                    duration: 0.2
                },
                0.02
            );
        }

        scrubTl.to('.hero-scrim-left', {
            opacity: 0,
            ease: 'power1.out',
            duration: 0.24
        }, 0.06);

        // Mantém a timeline cobrindo toda a distância de 0 -> 1
        scrubTl.to({}, { duration: 1 }, 0);

        heroST = scrubTl.scrollTrigger;

        // Inicializa animações das dobras seguintes SOMENTE após o pinSpacing da Hero existir
        initTechFoldAnimations();
        initLabFoldAnimations();
        initCinemaFoldAnimations();
        ScrollTrigger.refresh();

        // Garante atualização após fontes carregarem completamente
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(() => {
                ScrollTrigger.refresh();
            });
        }
    }

    if (canvas && ctx) {
        // Carrega frame inicial com prioridade máxima e inicia pré-carregamento progressivo
        loadSingleFrame(0);
        enqueueRemainingFrames();

        // Segurança caso o frame 0 atrase em rede lenta
        setTimeout(() => {
            if (!scrollTriggerReady) initScrollExperience();
        }, 1200);
    } else {
        initScrollExperience();
    }

    /* ----------------------------------------------------------------
       5. SEGUNDA DOBRA: ANIMAÇÕES DE ENTRADA, TOUR, 3D TILT E SAÍDA
    ---------------------------------------------------------------- */
    let techAnimInitialized = false;
    let hoverBenefitId = null;
    let scrollBenefitId = null;

    const benefitItems = document.querySelectorAll('.tech-benefit-item');
    const techNodes = document.querySelectorAll('.tech-node');
    const showcaseCard = document.getElementById('tech-showcase-card');
    const cadCoordsEl = document.getElementById('tech-cad-coords');

    function syncBenefitHighlight() {
        const activeId = hoverBenefitId || scrollBenefitId;
        benefitItems.forEach((el) => el.classList.toggle('is-active', el.dataset.benefit === activeId));
        techNodes.forEach((el) => el.classList.toggle('is-active', el.dataset.node === activeId));
    }

    function initTechFoldAnimations() {
        if (techAnimInitialized) return;
        techAnimInitialized = true;

        const techSection = document.getElementById('tecnologia');
        const techHeaderWrap = document.querySelector('.tech-header');
        const techHeaderRule = document.querySelector('.tech-header-rule');
        const techHeadingEl = document.getElementById('tech-heading');
        const techHeaderEls = document.querySelectorAll('.js-tech-header');
        const techGlowLeft = document.querySelector('.tech-ambient-glow--left');
        const techGlowRight = document.querySelector('.tech-ambient-glow--right');
        const techShowcaseEl = document.querySelector('.js-tech-showcase');
        const techPhotoEl = document.querySelector('.js-tech-photo');
        const techRingEl = document.querySelector('.js-tech-ring');
        const techInnerRingEl = document.querySelector('.tech-orbit-ring--inner');
        const techSheenEl = document.querySelector('.tech-showcase-sheen');
        const techBlueprintLines = document.querySelectorAll('.tech-blueprint-line');
        const techItemWraps = document.querySelectorAll('.js-tech-item');

        if (techSection && !prefersReducedMotion) {
            let techSplit = null;
            if (typeof SplitText !== 'undefined' && techHeadingEl) {
                techSplit = new SplitText(techHeadingEl, { type: 'words' });
            }

            const otherHeaderEls = Array.from(techHeaderEls).filter(
                (el) => !techSplit || el !== techHeadingEl
            );

            // 5A. Entrada e Saída reversa sincronizadas ao entrar/sair da dobra (top 94% -> top 28%)
            const entranceTl = gsap.timeline({
                scrollTrigger: {
                    trigger: techSection,
                    start: 'top 94%',
                    end: 'top 28%',
                    scrub: 0.65,
                    invalidateOnRefresh: true
                }
            });

            if (techHeaderRule) {
                entranceTl.fromTo(techHeaderRule,
                    { scaleX: 0 },
                    { scaleX: 1, duration: 0.55, ease: 'power2.out' },
                    0
                );
            }

            if (otherHeaderEls.length) {
                entranceTl.fromTo(otherHeaderEls,
                    { y: 34, autoAlpha: 0, filter: 'blur(10px)' },
                    { y: 0, autoAlpha: 1, filter: 'blur(0px)', stagger: 0.08, duration: 0.5, ease: 'power2.out' },
                    0.04
                );
            }

            if (techSplit && techSplit.words.length) {
                entranceTl.fromTo(techSplit.words,
                    { y: 26, autoAlpha: 0, filter: 'blur(10px)' },
                    { y: 0, autoAlpha: 1, filter: 'blur(0px)', stagger: 0.06, duration: 0.48, ease: 'power2.out' },
                    0.06
                );
            }

            if (techShowcaseEl) {
                entranceTl.fromTo(techShowcaseEl,
                    { y: 46, scale: 0.93, autoAlpha: 0, filter: 'blur(12px)' },
                    { y: 0, scale: 1, autoAlpha: 1, filter: 'blur(0px)', duration: 0.62, ease: 'power2.out' },
                    0.12
                );
            }

            if (techBlueprintLines.length) {
                entranceTl.fromTo(techBlueprintLines,
                    { strokeDashoffset: 180 },
                    { strokeDashoffset: 0, stagger: 0.06, duration: 0.45, ease: 'power2.out' },
                    0.32
                );
            }

            if (techNodes.length) {
                entranceTl.fromTo(techNodes,
                    { autoAlpha: 0, filter: 'blur(6px)' },
                    { autoAlpha: 1, filter: 'blur(0px)', stagger: 0.07, duration: 0.42, ease: 'power2.out' },
                    0.38
                );
            }

            if (techSheenEl) {
                entranceTl.fromTo(techSheenEl,
                    { xPercent: -120 },
                    { xPercent: 130, duration: 0.65, ease: 'power1.inOut' },
                    0.25
                );
            }

            if (techItemWraps.length) {
                entranceTl.fromTo(techItemWraps,
                    { x: 24, y: 28, autoAlpha: 0, filter: 'blur(8px)' },
                    { x: 0, y: 0, autoAlpha: 1, filter: 'blur(0px)', stagger: 0.12, duration: 0.5, ease: 'power2.out' },
                    0.18
                );
            }

            // 5B. Leitura contínua: parallax, rotação dupla de anéis e tour sequencial 01 -> 02 -> 03
            const depthTl = gsap.timeline({
                scrollTrigger: {
                    trigger: techSection,
                    start: 'top 36%',
                    end: 'bottom bottom',
                    scrub: 0.55,
                    invalidateOnRefresh: true,
                    onUpdate: (self) => {
                        const p = self.progress;
                        if (p <= 0.02) {
                            scrollBenefitId = null;
                        } else if (p < 0.35) {
                            scrollBenefitId = '1';
                        } else if (p < 0.68) {
                            scrollBenefitId = '2';
                        } else {
                            scrollBenefitId = '3';
                        }
                        syncBenefitHighlight();
                    },
                    onLeaveBack: () => {
                        scrollBenefitId = null;
                        syncBenefitHighlight();
                    }
                }
            });

            if (techGlowLeft) {
                depthTl.fromTo(techGlowLeft,
                    { y: -24 },
                    { y: 24, ease: 'none', duration: 1 },
                    0
                );
            }

            if (techGlowRight) {
                depthTl.fromTo(techGlowRight,
                    { y: 28 },
                    { y: -28, ease: 'none', duration: 1 },
                    0
                );
            }

            if (techPhotoEl) {
                depthTl.fromTo(techPhotoEl,
                    { y: 14, scale: 1.04 },
                    { y: -14, scale: 1.0, ease: 'none', duration: 1 },
                    0
                );
            }

            if (techRingEl) {
                depthTl.fromTo(techRingEl,
                    { rotate: -14 },
                    { rotate: 22, ease: 'none', duration: 1 },
                    0
                );
            }

            if (techInnerRingEl) {
                depthTl.fromTo(techInnerRingEl,
                    { rotate: 12 },
                    { rotate: -24, ease: 'none', duration: 1 },
                    0
                );
            }

            // Saída sutil do cabeçalho e elevação do card ao deslizar pelo percurso da dobra
            if (techHeaderWrap) {
                depthTl.to(techHeaderWrap, {
                    y: -18,
                    autoAlpha: 0.65,
                    filter: 'blur(2px)',
                    ease: 'power1.in',
                    duration: 0.45
                }, 0.55);
            }

            if (showcaseCard) {
                depthTl.to(showcaseCard, {
                    y: -14,
                    scale: 0.985,
                    ease: 'power1.inOut',
                    duration: 0.5
                }, 0.5);
            }
        }

        // Destaque ativo na navegação conforme seção visível
        if (techSection) {
            ScrollTrigger.create({
                trigger: techSection,
                start: 'top 45%',
                end: 'bottom 45%',
                invalidateOnRefresh: true,
                onEnter: () => setActiveNav('tecnologia'),
                onEnterBack: () => setActiveNav('tecnologia'),
                onLeaveBack: () => setActiveNav('produto')
            });
        }
    }

    // Acoplamento interativo + micro-tilt 3D e flashlight radial no showcase
    benefitItems.forEach((item) => {
        item.addEventListener('mouseenter', () => {
            hoverBenefitId = item.dataset.benefit;
            syncBenefitHighlight();
        });
        item.addEventListener('mousemove', (e) => {
            const rect = item.getBoundingClientRect();
            item.style.setProperty('--card-x', `${e.clientX - rect.left}px`);
            item.style.setProperty('--card-y', `${e.clientY - rect.top}px`);
        });
        item.addEventListener('mouseleave', () => {
            hoverBenefitId = null;
            syncBenefitHighlight();
        });
    });

    techNodes.forEach((node) => {
        node.addEventListener('mouseenter', () => {
            hoverBenefitId = node.dataset.node;
            syncBenefitHighlight();
        });
        node.addEventListener('mouseleave', () => {
            hoverBenefitId = null;
            syncBenefitHighlight();
        });
    });

    if (showcaseCard) {
        const useTilt = hasGSAP && !prefersReducedMotion;
        const tiltX = useTilt ? gsap.quickTo(showcaseCard, 'rotateY', { duration: 0.45, ease: 'power3.out' }) : null;
        const tiltY = useTilt ? gsap.quickTo(showcaseCard, 'rotateX', { duration: 0.45, ease: 'power3.out' }) : null;

        showcaseCard.addEventListener('mousemove', (e) => {
            const rect = showcaseCard.getBoundingClientRect();
            const relX = (e.clientX - rect.left) / rect.width;
            const relY = (e.clientY - rect.top) / rect.height;
            showcaseCard.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
            showcaseCard.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);

            if (cadCoordsEl) {
                const px = Math.min(99, Math.max(0, Math.round(relX * 100))).toString().padStart(2, '0');
                const py = Math.min(99, Math.max(0, Math.round(relY * 100))).toString().padStart(2, '0');
                cadCoordsEl.textContent = `X:${px} Y:${py}`;
            }

            if (tiltX && tiltY && window.innerWidth >= 1024) {
                tiltX((relX - 0.5) * 6.5);
                tiltY((0.5 - relY) * 5.5);
            }
        });

        showcaseCard.addEventListener('mouseleave', () => {
            if (tiltX) tiltX(0);
            if (tiltY) tiltY(0);
            if (cadCoordsEl) {
                cadCoordsEl.textContent = 'X:50 Y:50';
            }
        });
    }

    /* ----------------------------------------------------------------
       5C. TERCEIRA DOBRA: BANCADA INTERATIVA, SWITCHER E SCROLLTRIGGER
    ---------------------------------------------------------------- */
    let labAnimInitialized = false;

    function initLabFoldAnimations() {
        if (labAnimInitialized) return;
        labAnimInitialized = true;

        const labSection = document.getElementById('experiencia');
        const labHeaderRule = document.querySelector('.lab-header-rule');
        const labHeadingEl = document.getElementById('lab-heading');
        const labHeaderEls = document.querySelectorAll('.js-lab-header');
        const labPadEl = document.querySelector('.js-lab-pad');
        const labMatrixEl = document.querySelector('.js-lab-matrix');
        const labBars = document.querySelectorAll('.js-lab-bar');
        const labCards = document.querySelectorAll('.js-lab-card');

        if (labSection && !prefersReducedMotion) {
            let labSplit = null;
            if (typeof SplitText !== 'undefined' && labHeadingEl) {
                labSplit = new SplitText(labHeadingEl, { type: 'words' });
            }

            const otherLabHeaders = Array.from(labHeaderEls).filter(
                (el) => !labSplit || el !== labHeadingEl
            );

            const labEntranceTl = gsap.timeline({
                scrollTrigger: {
                    trigger: labSection,
                    start: 'top 92%',
                    end: 'top 25%',
                    scrub: 0.65,
                    invalidateOnRefresh: true
                }
            });

            if (labHeaderRule) {
                labEntranceTl.fromTo(labHeaderRule,
                    { scaleX: 0 },
                    { scaleX: 1, duration: 0.55, ease: 'power2.out' },
                    0
                );
            }

            if (otherLabHeaders.length) {
                labEntranceTl.fromTo(otherLabHeaders,
                    { y: 34, autoAlpha: 0, filter: 'blur(10px)' },
                    { y: 0, autoAlpha: 1, filter: 'blur(0px)', stagger: 0.08, duration: 0.5, ease: 'power2.out' },
                    0.04
                );
            }

            if (labSplit && labSplit.words.length) {
                labEntranceTl.fromTo(labSplit.words,
                    { y: 26, autoAlpha: 0, filter: 'blur(10px)' },
                    { y: 0, autoAlpha: 1, filter: 'blur(0px)', stagger: 0.055, duration: 0.48, ease: 'power2.out' },
                    0.06
                );
            }

            if (labPadEl) {
                labEntranceTl.fromTo(labPadEl,
                    { y: 42, scale: 0.96, autoAlpha: 0, filter: 'blur(10px)' },
                    { y: 0, scale: 1, autoAlpha: 1, filter: 'blur(0px)', duration: 0.6, ease: 'power2.out' },
                    0.14
                );
            }

            if (labMatrixEl) {
                labEntranceTl.fromTo(labMatrixEl,
                    { y: 42, scale: 0.96, autoAlpha: 0, filter: 'blur(10px)' },
                    { y: 0, scale: 1, autoAlpha: 1, filter: 'blur(0px)', duration: 0.6, ease: 'power2.out' },
                    0.22
                );
            }

            if (labBars.length) {
                labEntranceTl.fromTo(labBars,
                    { scaleX: 0 },
                    { scaleX: 1, stagger: 0.08, duration: 0.55, ease: 'power2.out' },
                    0.36
                );
            }

            if (labCards.length) {
                gsap.fromTo(labCards,
                    { y: 32, autoAlpha: 0, filter: 'blur(8px)' },
                    {
                        y: 0,
                        autoAlpha: 1,
                        filter: 'blur(0px)',
                        stagger: 0.1,
                        duration: 0.55,
                        ease: 'power2.out',
                        scrollTrigger: {
                            trigger: '.lab-spec-frame',
                            start: 'top 90%',
                            end: 'top 52%',
                            scrub: 0.55,
                            invalidateOnRefresh: true
                        }
                    }
                );
            }
        }

        if (labSection) {
            ScrollTrigger.create({
                trigger: labSection,
                start: 'top 45%',
                end: 'bottom 45%',
                invalidateOnRefresh: true,
                onEnter: () => setActiveNav('experiencia'),
                onEnterBack: () => setActiveNav('experiencia'),
                onLeaveBack: () => setActiveNav('tecnologia')
            });
        }
    }

    /* ----------------------------------------------------------------
       5D. QUARTA DOBRA: VÍDEO NO FUNDO + BOX GLOW & FLOW (FINALE)
    ---------------------------------------------------------------- */
    let cinemaAnimInitialized = false;
    let cinemaListenersBound = false;

    function initCinemaInteractiveListeners() {
        if (cinemaListenersBound) return;
        cinemaListenersBound = true;

        const cinemaGlowSurface = document.getElementById('cinema-glow-surface');
        const cinemaTiles = document.querySelectorAll('.js-cinema-tile');

        if (cinemaGlowSurface) {
            cinemaGlowSurface.addEventListener('mousemove', (e) => {
                const rect = cinemaGlowSurface.getBoundingClientRect();
                cinemaGlowSurface.style.setProperty('--glow-x', `${e.clientX - rect.left}px`);
                cinemaGlowSurface.style.setProperty('--glow-y', `${e.clientY - rect.top}px`);
            });
        }

        cinemaTiles.forEach((tile) => {
            tile.addEventListener('mousemove', (e) => {
                const rect = tile.getBoundingClientRect();
                tile.style.setProperty('--tile-x', `${e.clientX - rect.left}px`);
                tile.style.setProperty('--tile-y', `${e.clientY - rect.top}px`);
            });
        });
    }

    function initCinemaFoldAnimations() {
        if (cinemaAnimInitialized) return;
        cinemaAnimInitialized = true;
        initCinemaInteractiveListeners();

        const cinemaSection = document.getElementById('garantia');
        const cinemaHeaderRule = document.querySelector('.cinema-header-rule');
        const cinemaVideo = document.getElementById('cinema-bg-video');
        const cinemaHeadingEl = document.getElementById('cinema-heading');
        const cinemaHeaderEls = document.querySelectorAll('.js-cinema-header');
        const cinemaGlowBox = document.getElementById('cinema-glow-box');
        const cinemaTiles = document.querySelectorAll('.js-cinema-tile');

        if (cinemaSection && !prefersReducedMotion) {
            let cinemaSplit = null;
            if (typeof SplitText !== 'undefined' && cinemaHeadingEl) {
                cinemaSplit = new SplitText(cinemaHeadingEl, { type: 'words' });
            }

            const otherCinemaHeaders = Array.from(cinemaHeaderEls).filter(
                (el) => !cinemaSplit || el !== cinemaHeadingEl
            );

            const cinemaEntranceTl = gsap.timeline({
                scrollTrigger: {
                    trigger: cinemaSection,
                    start: 'top 90%',
                    end: 'top 25%',
                    scrub: 0.65,
                    invalidateOnRefresh: true
                }
            });

            if (cinemaHeaderRule) {
                cinemaEntranceTl.fromTo(cinemaHeaderRule,
                    { scaleX: 0 },
                    { scaleX: 1, duration: 0.55, ease: 'power2.out' },
                    0
                );
            }

            if (otherCinemaHeaders.length) {
                cinemaEntranceTl.fromTo(otherCinemaHeaders,
                    { y: 32, autoAlpha: 0, filter: 'blur(10px)' },
                    { y: 0, autoAlpha: 1, filter: 'blur(0px)', stagger: 0.08, duration: 0.5, ease: 'power2.out' },
                    0.02
                );
            }

            if (cinemaSplit && cinemaSplit.words.length) {
                cinemaEntranceTl.fromTo(cinemaSplit.words,
                    { y: 26, autoAlpha: 0, filter: 'blur(10px)' },
                    { y: 0, autoAlpha: 1, filter: 'blur(0px)', stagger: 0.055, duration: 0.48, ease: 'power2.out' },
                    0.06
                );
            }

            if (cinemaGlowBox) {
                cinemaEntranceTl.fromTo(cinemaGlowBox,
                    { y: 44, scale: 0.95, autoAlpha: 0, filter: 'blur(12px)' },
                    { y: 0, scale: 1, autoAlpha: 1, filter: 'blur(0px)', duration: 0.65, ease: 'power2.out' },
                    0.14
                );
            }

            if (cinemaTiles.length) {
                cinemaEntranceTl.fromTo(cinemaTiles,
                    { x: 18, autoAlpha: 0, filter: 'blur(6px)' },
                    { x: 0, autoAlpha: 1, filter: 'blur(0px)', stagger: 0.08, duration: 0.42, ease: 'power2.out' },
                    0.32
                );
            }
        }

        if (cinemaSection) {
            const playBgVideo = () => {
                if (cinemaVideo && cinemaVideo.paused) {
                    const p = cinemaVideo.play();
                    if (p && typeof p.catch === 'function') p.catch(() => { });
                }
            };
            const pauseBgVideo = () => {
                if (cinemaVideo && !cinemaVideo.paused) {
                    cinemaVideo.pause();
                }
            };

            ScrollTrigger.create({
                trigger: cinemaSection,
                start: 'top 75%',
                end: 'bottom top',
                invalidateOnRefresh: true,
                onEnter: playBgVideo,
                onEnterBack: playBgVideo,
                onLeave: pauseBgVideo,
                onLeaveBack: pauseBgVideo
            });

            ScrollTrigger.create({
                trigger: cinemaSection,
                start: 'top 45%',
                end: 'bottom 45%',
                invalidateOnRefresh: true,
                onEnter: () => setActiveNav('garantia'),
                onEnterBack: () => setActiveNav('garantia'),
                onLeaveBack: () => setActiveNav('experiencia')
            });
        }
    }

    // Mesa Digital Interativa de Teste 0.1mm
    const inkCanvas = document.getElementById('ink-test-canvas');
    const inkStage = document.getElementById('lab-canvas-stage');
    const inkPrompt = document.getElementById('lab-pad-prompt');
    const speedEl = document.getElementById('lab-speed');
    const dryTimeEl = document.getElementById('lab-dry-time');
    const strokeCountEl = document.getElementById('lab-stroke-count');
    const clearInkBtn = document.getElementById('lab-ink-clear');
    const paperChips = document.querySelectorAll('.lab-chip[data-paper]');
    const inkBtns = document.querySelectorAll('.lab-ink-btn[data-ink]');

    const dryRates = {
        bristol: '0.4s Dry',
        cotton: '0.3s Dry',
        vellum: '0.6s Film'
    };

    let activeInkColor = '#1C1C1C';
    let inkStrokes = [];
    let currentStroke = null;
    let isDrawingInk = false;
    let lastInkPt = null;
    let hasDrawnSample = false;

    function buildDemoStroke(w, h) {
        const pts = [];
        const steps = 64;
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const x = w * (0.14 + t * 0.72);
            const wave = Math.sin(t * Math.PI * 3.2) * (h * 0.16) * Math.sin(t * Math.PI);
            const arch = Math.cos(t * Math.PI * 1.4) * (h * 0.06);
            const y = h * 0.5 + wave - arch;
            pts.push({ x, y, lw: 1.45 });
        }
        return { color: '#1C1C1C', points: pts };
    }

    function redrawInkCanvas() {
        if (!inkCanvas || !inkStage) return;
        const c = inkCanvas.getContext('2d');
        if (!c) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const w = inkStage.clientWidth;
        const h = inkStage.clientHeight;
        if (!w || !h) return;

        if (inkCanvas.width !== Math.round(w * dpr) || inkCanvas.height !== Math.round(h * dpr)) {
            inkCanvas.width = Math.round(w * dpr);
            inkCanvas.height = Math.round(h * dpr);
        }

        c.setTransform(dpr, 0, 0, dpr, 0, 0);
        c.clearRect(0, 0, w, h);

        if (!hasDrawnSample && inkStrokes.length === 0) {
            hasDrawnSample = true;
            inkStrokes.push(buildDemoStroke(w, h));
        }

        c.lineCap = 'round';
        c.lineJoin = 'round';

        inkStrokes.forEach((stroke) => {
            const pts = stroke.points;
            if (pts.length < 2) return;
            c.strokeStyle = stroke.color;
            c.lineWidth = pts[0].lw || 1.4;
            c.beginPath();
            c.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length - 1; i++) {
                const midX = (pts[i].x + pts[i + 1].x) * 0.5;
                const midY = (pts[i].y + pts[i + 1].y) * 0.5;
                c.quadraticCurveTo(pts[i].x, pts[i].y, midX, midY);
            }
            const last = pts[pts.length - 1];
            c.lineTo(last.x, last.y);
            c.stroke();
        });

        if (strokeCountEl) {
            strokeCountEl.textContent = String(inkStrokes.length).padStart(2, '0');
        }
    }

    if (inkCanvas && inkStage) {
        redrawInkCanvas();
        if (typeof ResizeObserver !== 'undefined') {
            new ResizeObserver(() => redrawInkCanvas()).observe(inkStage);
        }

        const getPadCoords = (e) => {
            const rect = inkCanvas.getBoundingClientRect();
            return {
                x: e.clientX - rect.left,
                y: e.clientY - rect.top,
                t: performance.now()
            };
        };

        inkCanvas.addEventListener('pointerdown', (e) => {
            try {
                inkCanvas.setPointerCapture(e.pointerId);
            } catch (_) {
                // Ignora em navegadores ou eventos sintéticos sem ponteiro ativo
            }
            isDrawingInk = true;
            const pt = getPadCoords(e);
            lastInkPt = pt;
            currentStroke = {
                color: activeInkColor,
                points: [{ x: pt.x, y: pt.y, lw: 1.4 }]
            };
            inkStrokes.push(currentStroke);
            if (inkPrompt) inkPrompt.style.opacity = '0.35';
            redrawInkCanvas();
        });

        inkCanvas.addEventListener('pointermove', (e) => {
            if (!isDrawingInk || !currentStroke || !lastInkPt) return;
            const pt = getPadCoords(e);
            const dx = pt.x - lastInkPt.x;
            const dy = pt.y - lastInkPt.y;
            const dist = Math.hypot(dx, dy);
            if (dist < 1.2) return;

            const dt = Math.max(pt.t - lastInkPt.t, 4);
            const mmPerSec = Math.min(999, Math.round((dist / dt) * 260));
            if (speedEl) {
                speedEl.textContent = `${String(mmPerSec).padStart(3, '0')} mm/s`;
            }

            currentStroke.points.push({ x: pt.x, y: pt.y, lw: 1.4 });
            lastInkPt = pt;
            redrawInkCanvas();
        });

        const endInkStroke = () => {
            if (!isDrawingInk) return;
            isDrawingInk = false;
            currentStroke = null;
            lastInkPt = null;
            if (speedEl) speedEl.textContent = '000 mm/s';
        };

        inkCanvas.addEventListener('pointerup', endInkStroke);
        inkCanvas.addEventListener('pointercancel', endInkStroke);
    }

    paperChips.forEach((chip) => {
        chip.addEventListener('click', () => {
            paperChips.forEach((c) => c.classList.remove('is-active'));
            chip.classList.add('is-active');
            const paper = chip.dataset.paper;
            if (inkStage) inkStage.setAttribute('data-paper', paper);
            if (dryTimeEl && dryRates[paper]) {
                dryTimeEl.textContent = dryRates[paper];
            }
        });
    });

    inkBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
            inkBtns.forEach((b) => b.classList.remove('is-active'));
            btn.classList.add('is-active');
            activeInkColor = btn.dataset.ink || '#1C1C1C';
        });
    });

    if (clearInkBtn) {
        clearInkBtn.addEventListener('click', () => {
            inkStrokes = [];
            hasDrawnSample = true;
            redrawInkCanvas();
            if (inkPrompt) inkPrompt.style.opacity = '1';
            if (speedEl) speedEl.textContent = '000 mm/s';
        });
    }

    // Stack Switcher Série 01 (design-system.html)
    const stackSpecs = [
        {
            idx: 'ESPEC 01 / 04',
            title: 'Kit Série 01 Numerado',
            desc: 'Inclui caneta CNC 0.1mm, 2 recargas Nano-Carbono seladas a vácuo e certificado individual de calibração laser.'
        },
        {
            idx: 'ESPEC 02 / 04',
            title: 'Usinagem Suíça 5-Eixos',
            desc: 'Rosca selada em latão naval e ponta em aço tungstênio com tolerância zero de folga durante traços rápidos.'
        },
        {
            idx: 'ESPEC 03 / 04',
            title: 'Válvula Barométrica de Altitude',
            desc: 'Câmara de compensação interna equalizada para voos de cabine até 12.000m sem vazamentos na tampa.'
        },
        {
            idx: 'ESPEC 04 / 04',
            title: 'Garantia Estrutural Vitalícia',
            desc: 'Corpo monobloco em alumínio aeroespacial AL-7075 anodizado com cobertura vitalícia contra defeitos de usinagem.'
        }
    ];
    let stackCursor = 0;
    const stackCardEl = document.getElementById('lab-stack-card');
    const stackIdxEl = document.getElementById('lab-stack-idx');
    const stackTitleEl = document.getElementById('lab-stack-title');
    const stackDescEl = document.getElementById('lab-stack-desc');

    function updateStackSpec(delta) {
        stackCursor = (stackCursor + delta + stackSpecs.length) % stackSpecs.length;
        if (!stackCardEl) return;
        stackCardEl.classList.add('is-switching');
        setTimeout(() => {
            const item = stackSpecs[stackCursor];
            if (stackIdxEl) stackIdxEl.textContent = item.idx;
            if (stackTitleEl) stackTitleEl.textContent = item.title;
            if (stackDescEl) stackDescEl.textContent = item.desc;
            stackCardEl.classList.remove('is-switching');
        }, 150);
    }

    const stackPrevBtn = document.getElementById('lab-stack-prev');
    const stackNextBtn = document.getElementById('lab-stack-next');
    if (stackPrevBtn) stackPrevBtn.addEventListener('click', () => updateStackSpec(-1));
    if (stackNextBtn) stackNextBtn.addEventListener('click', () => updateStackSpec(1));

    // Spotlight radial nos .flashlight-card da Dobra 03
    document.querySelectorAll('.flashlight-card').forEach((card) => {
        card.addEventListener('mousemove', (e) => {
            const rect = card.getBoundingClientRect();
            card.style.setProperty('--mouse-x', `${e.clientX - rect.left}px`);
            card.style.setProperty('--mouse-y', `${e.clientY - rect.top}px`);
        });
    });

    /* ----------------------------------------------------------------
       6. MICROINTERAÇÕES, NAVEGAÇÃO & RESPONSIVIDADE
    ---------------------------------------------------------------- */
    // Toggle de superfície (#FFFFFF <-> #EAEAE5)
    const surfaceToggle = document.getElementById('surface-toggle');
    const surfaceLabel = document.getElementById('surface-label');
    if (surfaceToggle) {
        surfaceToggle.addEventListener('click', () => {
            const isAlabaster = document.documentElement.getAttribute('data-surface') === 'alabaster';
            if (isAlabaster) {
                document.documentElement.removeAttribute('data-surface');
                if (surfaceLabel) surfaceLabel.textContent = 'Canvas';
            } else {
                document.documentElement.setAttribute('data-surface', 'alabaster');
                if (surfaceLabel) surfaceLabel.textContent = 'Alabastro';
            }
        });
    }

    // Destaque ativo na navegação
    const navLinks = document.querySelectorAll('.nav-link');
    const setActiveNav = (key) => {
        navLinks.forEach((link) => {
            link.classList.toggle('is-active', link.dataset.nav === key);
        });
    };

    // Rolagem suave para âncoras (compatível com Lenis, GSAP e fallback nativo)
    document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
        anchor.addEventListener('click', (e) => {
            const href = anchor.getAttribute('href');
            if (href === '#comprar') {
                e.preventDefault();
                openBuyModal(anchor);
                return;
            }
            if (!href || href === '#') return;
            const target = document.querySelector(href);
            if (!target) return;
            e.preventDefault();
            if (lenis) {
                lenis.scrollTo(target, { offset: -70 });
            } else if (hasGSAP && hasScrollTo) {
                gsap.to(window, {
                    duration: 0.9,
                    scrollTo: { y: target, offsetY: 70 },
                    ease: 'power3.inOut'
                });
            } else {
                target.scrollIntoView({
                    behavior: prefersReducedMotion ? 'auto' : 'smooth',
                    block: 'start'
                });
            }
        });
    });

    // Modal preparado para ação Comprar Agora
    const buyModal = document.getElementById('buy-modal');
    const closeModalBtn = document.getElementById('close-modal');
    let lastModalTrigger = null;

    function openBuyModal(triggerEl) {
        if (!buyModal) return;
        lastModalTrigger = triggerEl || document.activeElement;
        buyModal.classList.add('is-open');
        buyModal.setAttribute('aria-hidden', 'false');
        if (closeModalBtn) {
            requestAnimationFrame(() => closeModalBtn.focus());
        }
    }

    function closeBuyModal() {
        if (!buyModal || !buyModal.classList.contains('is-open')) return;
        buyModal.classList.remove('is-open');
        buyModal.setAttribute('aria-hidden', 'true');
        if (lastModalTrigger && typeof lastModalTrigger.focus === 'function') {
            lastModalTrigger.focus();
            lastModalTrigger = null;
        }
    }

    if (closeModalBtn) closeModalBtn.addEventListener('click', closeBuyModal);
    if (buyModal) {
        buyModal.addEventListener('click', (e) => {
            if (e.target === buyModal) closeBuyModal();
        });
    }
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeBuyModal();
    });

    // Recalcular layout em redimensionamento (debounced)
    let resizeTimer;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
            resizeCanvas();
            redrawInkCanvas();
            drawFrameForProgress(scrubState.smoothProgress, true);
            updateTelemetryUI(heroST ? heroST.progress : scrubState.smoothProgress);
            if (hasGSAP) ScrollTrigger.refresh();
        }, 180);
    });
});
