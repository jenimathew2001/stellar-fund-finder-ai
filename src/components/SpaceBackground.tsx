
import { useEffect, useRef } from "react";

export const SpaceBackground = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const stars: Array<{ x: number; y: number; z: number; size: number; opacity: number; speed: number }> = [];
    const planets: Array<{ x: number; y: number; z: number; size: number; color: string; rotationSpeed: number; rotation: number }> = [];

    // Create 3D stars with depth
    for (let i = 0; i < 400; i++) {
      stars.push({
        x: (Math.random() - 0.5) * 2000,
        y: (Math.random() - 0.5) * 2000,
        z: Math.random() * 1000,
        size: Math.random() * 2,
        opacity: Math.random(),
        speed: Math.random() * 0.5 + 0.1,
      });
    }

    // Create floating planets
    for (let i = 0; i < 3; i++) {
      planets.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        z: Math.random() * 500 + 200,
        size: Math.random() * 80 + 40,
        color: ['#4f46e5', '#7c3aed', '#ec4899', '#06b6d4'][Math.floor(Math.random() * 4)],
        rotationSpeed: (Math.random() - 0.5) * 0.02,
        rotation: 0,
      });
    }

    let mouseX = 0;
    let mouseY = 0;

    const handleMouseMove = (e: MouseEvent) => {
      mouseX = (e.clientX - canvas.width / 2) * 0.001;
      mouseY = (e.clientY - canvas.height / 2) * 0.001;
    };

    window.addEventListener('mousemove', handleMouseMove);

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw 3D stars with parallax effect
      stars.forEach((star) => {
        const x = (star.x / star.z) * 200 + canvas.width / 2 + mouseX * star.z * 0.1;
        const y = (star.y / star.z) * 200 + canvas.height / 2 + mouseY * star.z * 0.1;
        const size = (1 - star.z / 1000) * star.size * 2;

        if (x >= 0 && x <= canvas.width && y >= 0 && y <= canvas.height) {
          ctx.beginPath();
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255, 255, 255, ${star.opacity * (1 - star.z / 1000)})`;
          ctx.fill();

          // Add twinkling effect
          star.opacity += (Math.random() - 0.5) * 0.05;
          star.opacity = Math.max(0.1, Math.min(1, star.opacity));

          // Move stars towards viewer
          star.z -= star.speed;
          if (star.z <= 0) {
            star.z = 1000;
            star.x = (Math.random() - 0.5) * 2000;
            star.y = (Math.random() - 0.5) * 2000;
          }
        }
      });

      // Draw floating planets with 3D effect
      planets.forEach((planet) => {
        const x = planet.x + Math.sin(Date.now() * 0.001 + planet.rotation) * 50;
        const y = planet.y + Math.cos(Date.now() * 0.0007 + planet.rotation) * 30;
        const scale = (1 - planet.z / 1000) * 0.5 + 0.5;
        const size = planet.size * scale;

        // Create gradient for 3D effect
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, size);
        gradient.addColorStop(0, planet.color + '88');
        gradient.addColorStop(0.7, planet.color + '44');
        gradient.addColorStop(1, planet.color + '11');

        ctx.beginPath();
        ctx.arc(x, y, size, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();

        // Add subtle glow
        ctx.beginPath();
        ctx.arc(x, y, size * 1.2, 0, Math.PI * 2);
        ctx.fillStyle = planet.color + '22';
        ctx.fill();

        planet.rotation += planet.rotationSpeed;
      });

      requestAnimationFrame(animate);
    };

    animate();

    const handleResize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, []);

  return (
    <>
      <canvas
        ref={canvasRef}
        className="fixed inset-0 z-0"
        style={{ 
          background: "radial-gradient(ellipse at center, #1e1b4b 0%, #0f0f23 40%, #000000 100%)"
        }}
      />
      <div className="fixed inset-0 z-0 bg-gradient-to-b from-purple-900/10 via-transparent to-blue-900/20" />
      <div className="fixed inset-0 z-0 bg-gradient-to-r from-transparent via-purple-500/5 to-transparent" />
    </>
  );
};
