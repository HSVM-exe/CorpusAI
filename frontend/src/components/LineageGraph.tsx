import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';

type Node = { id: string; label: string };
type Edge = { from: string; to: string; label?: string };

type GraphData = { nodes: Node[]; edges: Edge[] };

interface LineageGraphProps {
  data: GraphData | null;
  activeStatus?: string;
}

const LineageGraph: React.FC<LineageGraphProps> = ({ data, activeStatus }) => {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!data || !svgRef.current) return;
    
    const container = svgRef.current.parentElement;
    const width = container ? container.clientWidth : 600;
    const height = 300;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    // Setup definitions for gradients and glow filters
    const defs = svg.append('defs');
    
    // Drop shadow / Glow filter
    const glowFilter = defs.append('filter')
      .attr('id', 'glow')
      .attr('x', '-50%')
      .attr('y', '-50%')
      .attr('width', '200%')
      .attr('height', '200%');
    glowFilter.append('feGaussianBlur')
      .attr('stdDeviation', '4')
      .attr('result', 'coloredBlur');
    const feMerge = glowFilter.append('feMerge');
    feMerge.append('feMergeNode').attr('in', 'coloredBlur');
    feMerge.append('feMergeNode').attr('in', 'SourceGraphic');

    // Radials for nodes
    const agentColors: Record<string, string[]> = {
      orchestrator: ['#a78bfa', '#6d28d9'], // purple
      marketing: ['#f472b6', '#db2777'],    // pink
      finance: ['#34d399', '#059669'],      // green
      engineering: ['#60a5fa', '#2563eb'],  // blue
      github: ['#fbbf24', '#d97706'],       // gold
      slack: ['#fb7185', '#e11d48'],        // rose
      default: ['#9ca3af', '#4b5563']       // grey
    };

    Object.entries(agentColors).forEach(([key, colors]) => {
      const grad = defs.append('radialGradient')
        .attr('id', `grad-${key}`)
        .attr('cx', '30%')
        .attr('cy', '30%')
        .attr('r', '70%');
      
      grad.append('stop')
        .attr('offset', '0%')
        .attr('stop-color', colors[0]);
      
      grad.append('stop')
        .attr('offset', '100%')
        .attr('stop-color', colors[1]);
    });

    const d3Links = data.edges.map(e => ({
      source: e.from,
      target: e.to,
      label: e.label
    }));

    const simulation = d3.forceSimulation(data.nodes as any)
      .force('link', d3.forceLink(d3Links).id((d: any) => d.id).distance(140))
      .force('charge', d3.forceManyBody().strength(-200))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('x', d3.forceX(width / 2).strength(0.08))
      .force('y', d3.forceY(height / 2).strength(0.08));

    // Link Lines (Background connection lines)
    const link = svg
      .append('g')
      .selectAll('path')
      .data(d3Links)
      .enter()
      .append('path')
      .attr('fill', 'none')
      .attr('stroke', 'rgba(255, 255, 255, 0.15)')
      .attr('stroke-width', 2.5);

    // Glowing Animated Particles flowing along connections
    const particles = svg
      .append('g')
      .selectAll('circle.particle')
      .data(d3Links)
      .enter()
      .append('circle')
      .attr('class', 'particle')
      .attr('r', 3.5)
      .attr('fill', '#a5f3fc') // bright cyan glowing particle
      .style('filter', 'url(#glow)')
      .each(function(d: any) {
        d.t = Math.random(); // randomize starting position on the connection path
      });

    // Link Label Texts
    const linkLabel = svg
      .append('g')
      .selectAll('text')
      .data(d3Links)
      .enter()
      .append('text')
      .attr('text-anchor', 'middle')
      .style('font-size', '0.65rem')
      .style('fill', 'rgba(255, 255, 255, 0.45)')
      .text((d: any) => d.label || '');

    // Drag helper
    const drag = d3.drag<SVGGElement, any>()
      .on('start', (event: any, d: any) => {
        if (!event.active) simulation.alphaTarget(0.3).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event: any, d: any) => {
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event: any, d: any) => {
        if (!event.active) simulation.alphaTarget(0);
        d.fx = null;
        d.fy = null;
      });

    // Node groups containing circles and labels
    const node = svg
      .append('g')
      .selectAll('g')
      .data(data.nodes as any)
      .enter()
      .append('g')
      .call(drag);

    // Node circle representation
    node.append('circle')
      .attr('r', (d: any) => {
        // Enlarge active agents relative to status
        const isCurrentAgent = getIsActiveAgent(d.id, activeStatus);
        return isCurrentAgent ? 26 : 20;
      })
      .attr('fill', (d: any) => {
        const colorKey = agentColors[d.id] ? d.id : 'default';
        return `url(#grad-${colorKey})`;
      })
      .style('filter', (d: any) => {
        const isCurrentAgent = getIsActiveAgent(d.id, activeStatus);
        return isCurrentAgent ? 'url(#glow)' : 'none';
      })
      .attr('stroke', (d: any) => {
        const isCurrentAgent = getIsActiveAgent(d.id, activeStatus);
        return isCurrentAgent ? '#ffffff' : 'rgba(255, 255, 255, 0.3)';
      })
      .attr('stroke-width', (d: any) => {
        const isCurrentAgent = getIsActiveAgent(d.id, activeStatus);
        return isCurrentAgent ? 2.5 : 1.5;
      });

    // Node label texts
    node.append('text')
      .attr('text-anchor', 'middle')
      .attr('dy', (d: any) => {
        const isCurrentAgent = getIsActiveAgent(d.id, activeStatus);
        return isCurrentAgent ? 34 : 28;
      })
      .style('font-size', '0.75rem')
      .style('font-weight', '600')
      .style('fill', 'var(--text-primary)')
      .style('text-shadow', '0 2px 4px rgba(0,0,0,0.8)')
      .text((d: any) => d.label);

    simulation.on('tick', () => {
      // Connect nodes via straight lines
      link.attr('d', (d: any) => {
        return `M${d.source.x},${d.source.y} L${d.target.x},${d.target.y}`;
      });

      // Update particle flows along links
      particles
        .attr('cx', (d: any) => d.source.x + d.t * (d.target.x - d.source.x))
        .attr('cy', (d: any) => d.source.y + d.t * (d.target.y - d.source.y))
        .each(function(d: any) {
          d.t = (d.t + 0.008) % 1.0; // speed of particle flow
        });

      // Update link labels to follow midpoints
      linkLabel
        .attr('x', (d: any) => (d.source.x + d.target.x) / 2)
        .attr('y', (d: any) => (d.source.y + d.target.y) / 2 - 6);

      // Move group node coordinates
      node.attr('transform', (d: any) => `translate(${d.x},${d.y})`);
    });

    return () => {
      simulation.stop();
    };
  }, [data, activeStatus]);

  // Determine if this D3 node represents an active agent based on initiative status
  function getIsActiveAgent(nodeId: string, status?: string): boolean {
    if (!status) return false;
    const cleanId = nodeId.toLowerCase();
    
    switch (status) {
      case 'Planning':
        return cleanId === 'marketing' || cleanId === 'finance' || cleanId === 'orchestrator';
      case 'Awaiting Approval':
        return cleanId === 'orchestrator';
      case 'Approved':
      case 'Executing':
        return cleanId === 'engineering' || cleanId === 'orchestrator';
      case 'Done':
        return cleanId === 'orchestrator';
      default:
        return false;
    }
  }

  return (
    <svg 
      ref={svgRef} 
      width="100%" 
      height="300" 
      style={{ 
        background: 'rgba(0, 0, 0, 0.25)', 
        borderRadius: '12px', 
        border: '1px solid var(--border-color)',
        overflow: 'hidden'
      }} 
    />
  );
};

export default LineageGraph;
