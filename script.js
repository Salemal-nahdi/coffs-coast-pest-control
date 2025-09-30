// Loader
window.addEventListener('load', () => {
    setTimeout(() => {
        document.querySelector('.loader-wrapper').style.opacity = '0';
        setTimeout(() => {
            document.querySelector('.loader-wrapper').style.display = 'none';
            document.getElementById('navbar').classList.add('visible');
        }, 500);
    }, 1500);
});

// Custom cursor removed for cleaner experience

// Particles
const particlesContainer = document.querySelector('.particles');
const particleCount = 50;

for (let i = 0; i < particleCount; i++) {
    const particle = document.createElement('div');
    particle.className = 'particle';
    particle.style.left = Math.random() * 100 + '%';
    particle.style.animationDelay = Math.random() * 10 + 's';
    particle.style.animationDuration = (Math.random() * 10 + 10) + 's';
    particlesContainer.appendChild(particle);
}

// Navigation
const navbar = document.getElementById('navbar');
const mobileMenuToggle = document.querySelector('.mobile-menu-toggle');
const navMenu = document.querySelector('.nav-menu');

window.addEventListener('scroll', () => {
    if (window.scrollY > 100) {
        navbar.classList.add('scrolled');
    } else {
        navbar.classList.remove('scrolled');
    }
});

mobileMenuToggle.addEventListener('click', () => {
    mobileMenuToggle.classList.toggle('active');
    navMenu.classList.toggle('active');
});

// Smooth Scroll
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            const offset = 80;
            const targetPosition = target.offsetTop - offset;
            window.scrollTo({
                top: targetPosition,
                behavior: 'smooth'
            });
            
            // Close mobile menu if open
            navMenu.classList.remove('active');
            mobileMenuToggle.classList.remove('active');
        }
    });
});

// Process Timeline Animation
const observerOptions = {
    threshold: 0.5,
    rootMargin: '0px 0px -100px 0px'
};

const timelineObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const steps = document.querySelectorAll('.timeline-step');
            
            let delay = 0;
            steps.forEach((step, index) => {
                setTimeout(() => {
                    step.classList.add('active');
                }, delay);
                delay += 500;
            });
            
            timelineObserver.unobserve(entry.target);
        }
    });
}, observerOptions);

const processSection = document.querySelector('.process-timeline');
if (processSection) {
    timelineObserver.observe(processSection);
}

// Service Cards Animation
const serviceObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry, index) => {
        if (entry.isIntersecting) {
            setTimeout(() => {
                entry.target.style.opacity = '0';
                entry.target.style.transform = 'translateY(30px)';
                
                setTimeout(() => {
                    entry.target.style.transition = 'all 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275)';
                    entry.target.style.opacity = '1';
                    entry.target.style.transform = 'translateY(0)';
                }, 100);
            }, index * 100);
            
            serviceObserver.unobserve(entry.target);
        }
    });
}, observerOptions);

document.querySelectorAll('.service-card').forEach(card => {
    serviceObserver.observe(card);
});

// Testimonials Carousel
const testimonials = [
    {
        content: "Cristian and his team were absolutely fantastic! They arrived on time, explained everything thoroughly, and completely eliminated our termite problem. Highly recommend!",
        author: "John Davidson",
        location: "Homeowner, Coffs Harbour",
        avatar: "JD"
    },
    {
        content: "Best pest control service in the area! They saved our restaurant from a cockroach infestation. Professional, efficient, and the results speak for themselves.",
        author: "Sarah Chen",
        location: "Restaurant Owner, Sawtell",
        avatar: "SC"
    },
    {
        content: "I've been using CCPC for preventive treatments for 3 years now. Haven't seen a single pest since they started. Worth every penny for the peace of mind!",
        author: "Michael Thompson",
        location: "Property Manager, Toormina",
        avatar: "MT"
    }
];

let currentTestimonial = 0;

function updateTestimonial() {
    const slide = document.querySelector('.testimonial-slide');
    const testimonial = testimonials[currentTestimonial];
    
    slide.querySelector('.testimonial-content').textContent = testimonial.content;
    slide.querySelector('.author-info h4').textContent = testimonial.author;
    slide.querySelector('.author-info p').textContent = testimonial.location;
    slide.querySelector('.author-avatar').textContent = testimonial.avatar;
}

document.getElementById('nextBtn').addEventListener('click', () => {
    currentTestimonial = (currentTestimonial + 1) % testimonials.length;
    updateTestimonial();
});

document.getElementById('prevBtn').addEventListener('click', () => {
    currentTestimonial = (currentTestimonial - 1 + testimonials.length) % testimonials.length;
    updateTestimonial();
});

// Back to Top
const backToTop = document.getElementById('backToTop');

window.addEventListener('scroll', () => {
    if (window.scrollY > 500) {
        backToTop.classList.add('visible');
    } else {
        backToTop.classList.remove('visible');
    }
});

backToTop.addEventListener('click', () => {
    window.scrollTo({
        top: 0,
        behavior: 'smooth'
    });
});

// Theme toggle removed for consistent design

// Form Validation
const form = document.querySelector('form');

form.addEventListener('submit', (e) => {
    e.preventDefault();
    
    // Add your form submission logic here
    alert('Thank you for your inquiry! We\'ll contact you within 24 hours.');
    form.reset();
});

// Add intersection observer for fade-in animations
const fadeElements = document.querySelectorAll('.section-header, .contact-card');

const fadeObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            entry.target.style.opacity = '0';
            entry.target.style.transform = 'translateY(30px)';
            
            setTimeout(() => {
                entry.target.style.transition = 'all 0.6s ease';
                entry.target.style.opacity = '1';
                entry.target.style.transform = 'translateY(0)';
            }, 100);
            
            fadeObserver.unobserve(entry.target);
        }
    });
}, observerOptions);

fadeElements.forEach(el => {
    fadeObserver.observe(el);
});
